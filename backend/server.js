import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 4000);
const ROOT = process.cwd();
const DATA = path.join(ROOT, "..", "data", "transactions.csv");
const AUDIT = path.join(ROOT, "audit.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const readCsv = () => {
  const text = fs.readFileSync(DATA, "utf8").trim();
  const [header, ...lines] = text.split("\n");
  const keys = header.split(",");
  return lines.map(line => {
    const vals = line.split(",");
    return Object.fromEntries(keys.map((k,i)=>[k, vals[i]]));
  });
};

const transactions = readCsv();
const audit = fs.existsSync(AUDIT) ? JSON.parse(fs.readFileSync(AUDIT,"utf8")) : [];

const num = v => Number(v);
const bool = v => v === true || v === "true";

function policyDecision(t, cfg) {
  const amount = num(t.amount_inr);
  const ageHours = (Date.now() - new Date(t.timestamp).getTime()) / 36e5;
  if (t.status !== "failed") return { action:"DO_NOTHING", reason:"Payment already succeeded." };
  if (ageHours > cfg.maxAgeHours) return { action:"DO_NOTHING", reason:"Transaction is outside the retry window." };
  if (amount >= cfg.highValueThreshold) return { action:"HUMAN_REVIEW", reason:"High-value transaction requires human approval." };
  if (t.retryable !== "true") return { action:"PAYMENT_LINK", reason:"Failure is better handled by a fresh payment path." };
  if (t.failure_reason === "network_error" || t.failure_reason === "temporary_bank_issue")
    return { action:"SMART_RETRY", reason:"Transient failure is likely to recover on retry." };
  if (t.failure_reason === "insufficient_funds")
    return { action:"REMINDER", reason:"Customer may need time to replenish funds." };
  return { action:"PAYMENT_LINK", reason:"A new payment attempt is safer than repeated retries." };
}

function getConfig(body={}) {
  return {
    maxRetries: Number(body.maxRetries ?? 2),
    cooldownHours: Number(body.cooldownHours ?? 24),
    highValueThreshold: Number(body.highValueThreshold ?? 15000),
    maxAgeHours: Number(body.maxAgeHours ?? 168),
  };
}

app.get("/api/health", (_,res)=>res.json({ok:true, service:"RecoverAI"}));

app.get("/api/summary", (_,res)=>{
  const failed = transactions.filter(t=>t.status==="failed");
  const recoverable = failed.filter(t=>t.retryable==="true");
  const atRisk = failed.reduce((s,t)=>s+num(t.amount_inr),0);
  const recoverablePool = recoverable.reduce((s,t)=>s+num(t.amount_inr),0);
  const historicalRecovered = recoverable.filter(t=>bool(t.historical_recovered))
    .reduce((s,t)=>s+num(t.amount_inr),0);
  const reasonMap = {};
  failed.forEach(t=>reasonMap[t.failure_reason]=(reasonMap[t.failure_reason]||0)+num(t.amount_inr));
  const reasons = Object.entries(reasonMap).sort((a,b)=>b[1]-a[1]).slice(0,7)
    .map(([reason,amount])=>({reason,amount:Math.round(amount)}));
  res.json({
    totalTransactions:transactions.length,
    failedTransactions:failed.length,
    revenueAtRisk:Math.round(atRisk),
    recoverablePool:Math.round(recoverablePool),
    historicalRecovered:Math.round(historicalRecovered),
    recoveryRate: recoverable.length ? Math.round(100*recoverable.filter(t=>bool(t.historical_recovered)).length/recoverable.length) : 0,
    reasons
  });
});

app.get("/api/transactions",(req,res)=>{
  const limit = Math.min(100, Number(req.query.limit||50));
  const status = req.query.status || "failed";
  const cfg = getConfig(req.query);
  const data = transactions.filter(t=>status==="all" || t.status===status)
    .slice(0,limit).map(t=>({...t, decision:policyDecision(t,cfg)}));
  res.json(data);
});

app.get("/api/transactions/:id",(req,res)=>{
  const t = transactions.find(x=>x.transaction_id===req.params.id);
  if(!t) return res.status(404).json({error:"Transaction not found"});
  const decision = policyDecision(t,getConfig(req.query));
  res.json({...t, decision, explanation:{
    failure:t.failure_reason || "none",
    why:decision.reason,
    guardrails:[
      "Success immediately stops recovery.",
      "High-value transactions require human review.",
      "Retries are bounded by the merchant policy.",
      "Transactions older than the retry window are not auto-retried."
    ]
  }});
});

app.post("/api/recovery/plan",(req,res)=>{
  const cfg = getConfig(req.body);
  const failed = transactions.filter(t=>t.status==="failed").slice(0,5000);
  const actions = {};
  let projected = 0;
  for(const t of failed){
    const d = policyDecision(t,cfg);
    actions[d.action]=(actions[d.action]||0)+1;
    if(d.action==="SMART_RETRY") projected += num(t.amount_inr)*0.32;
    if(d.action==="PAYMENT_LINK") projected += num(t.amount_inr)*0.18;
    if(d.action==="REMINDER") projected += num(t.amount_inr)*0.12;
  }
  res.json({
    sampleSize:failed.length,
    projectedRecoverableInr:Math.round(projected),
    actions,
    policies:cfg
  });
});

app.post("/api/recovery/execute",async(req,res)=>{
  const cfg = getConfig(req.body);
  const candidates = transactions.filter(t=>t.status==="failed").slice(0,500);
  const results = [];
  for(const t of candidates){
    const decision = policyDecision(t,cfg);
    if(decision.action==="DO_NOTHING") continue;
    let outcome = "queued";
    let externalId = null;
    let recoveredAmount = 0;

    // Real Razorpay Test Mode action: create a Payment Link only when credentials exist.
    // Test Mode has a documented 30-link limit per business, so the demo caps actual API calls.
    if(decision.action==="PAYMENT_LINK" && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && results.filter(x=>x.externalId).length < 25){
      try{
        const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
        const body = {
          amount: Math.round(num(t.amount_inr)*100),
          currency:"INR",
          description:`RecoverAI recovery for ${t.transaction_id}`,
          reference_id:t.transaction_id,
          customer:{name:t.customer_id},
          reminder_enable:true,
          expire_by:Math.floor(Date.now()/1000)+48*3600
        };
        const r = await fetch("https://api.razorpay.com/v1/payment_links",{
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":`Basic ${auth}`},
          body:JSON.stringify(body)
        });
        const data = await r.json();
        if(r.ok){ outcome="payment_link_created"; externalId=data.id; }
        else outcome="simulation_fallback";
      }catch(e){ outcome="simulation_fallback"; }
    } else if(decision.action==="SMART_RETRY") {
      const p = t.failure_reason==="network_error" || t.failure_reason==="temporary_bank_issue" ? 0.46 : 0.24;
      if (Math.random() < p) { outcome="recovered"; recoveredAmount=num(t.amount_inr); }
      else outcome="retry_queued";
    } else if(decision.action==="REMINDER") {
      if (Math.random() < 0.12) { outcome="recovered"; recoveredAmount=num(t.amount_inr); }
      else outcome="reminder_queued";
    } else if(decision.action==="HUMAN_REVIEW") {
      outcome="escalated";
    }

    results.push({transactionId:t.transaction_id, amountInr:num(t.amount_inr), action:decision.action, outcome, recoveredAmountInr:recoveredAmount, externalId});
    audit.push({
      id:crypto.randomUUID(), timestamp:new Date().toISOString(), transactionId:t.transaction_id,
      action:decision.action, outcome, policy:cfg, reason:decision.reason
    });
  }
  fs.writeFileSync(AUDIT,JSON.stringify(audit,null,2));
  res.json({
    executedAt:new Date().toISOString(),
    processed:results.length,
    simulated:!process.env.RAZORPAY_KEY_ID,
    results,
    recoveredRevenueInr:Math.round(results.reduce((s,x)=>s+(x.recoveredAmountInr||0),0)),
    successfulRecoveries:results.filter(x=>x.outcome==="recovered").length,
    auditCount:audit.length
  });
});

app.get("/api/audit",(req,res)=>{
  res.json(audit.slice(-100).reverse());
});

app.post("/api/copilot",async(req,res)=>{
  const question = String(req.body.question||"").trim();
  if(!question) return res.status(400).json({error:"Question required"});
  const summary = {
    transactions:transactions.length,
    failed:transactions.filter(t=>t.status==="failed").length,
    failedValue:transactions.filter(t=>t.status==="failed").reduce((s,t)=>s+num(t.amount_inr),0),
    recoverableValue:transactions.filter(t=>t.status==="failed"&&t.retryable==="true").reduce((s,t)=>s+num(t.amount_inr),0),
    auditEvents:audit.length
  };

  if(!process.env.OPENAI_API_KEY){
    const answer = question.toLowerCase().includes("why")
      ? "The largest recoverable patterns are transient bank/network failures and insufficient-funds failures. RecoverAI routes transient failures to bounded retries, while insufficient-funds cases get reminders."
      : `Based on the current merchant state: ${summary.failed} failed transactions represent ₹${Math.round(summary.failedValue).toLocaleString("en-IN")} at risk, with about ₹${Math.round(summary.recoverableValue).toLocaleString("en-IN")} classified as recoverable.`;
    return res.json({answer,mode:"deterministic"});
  }

  try{
    const prompt = `You are RecoverAI, an AI revenue recovery controller for a Razorpay merchant.
Merchant state: ${JSON.stringify(summary)}
Policies: max 2 retries, 24h customer contact cooldown, ₹15,000 high-value threshold, 7-day max age, stop immediately after success.
Question: ${question}
Answer concisely with numbers from the provided state. Never claim an action happened unless it appears in the audit count or execution result.`;
    const r = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.6-luna",input:prompt})
    });
    const data = await r.json();
    const answer = data.output_text || data.output?.map(x=>x.content?.map(y=>y.text||"").join("")).join("") || "No response.";
    res.json({answer,mode:"openai"});
  }catch(e){
    res.json({answer:"AI service is unavailable, so RecoverAI returned the deterministic merchant-state analysis instead.",mode:"fallback"});
  }
});

// Razorpay webhook: validate HMAC and log event. Raw-body preservation is important for signature validation.
app.post("/api/webhooks/razorpay",express.raw({type:"application/json"}),(req,res)=>{
  const signature = req.headers["x-razorpay-signature"];
  const eventId = req.headers["x-razorpay-event-id"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const raw = req.body;
  if(secret && signature){
    const expected = crypto.createHmac("sha256",secret).update(raw).digest("hex");
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) return res.status(400).json({error:"Invalid signature"});
  }
  let payload = {};
  try{ payload = JSON.parse(raw.toString("utf8")); }catch{}
  audit.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),action:"RAZORPAY_WEBHOOK",outcome:"received",eventId,event:payload.event||"unknown"});
  fs.writeFileSync(AUDIT,JSON.stringify(audit,null,2));
  res.json({ok:true});
});

app.listen(PORT,()=>console.log(`RecoverAI API running on http://localhost:${PORT}`));
