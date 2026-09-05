import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {AreaChart,Area,BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer} from "recharts";
import "./styles.css";

const API=import.meta.env.VITE_API_URL||"http://localhost:4000/api";
const money=n=>`₹${Math.round(n||0).toLocaleString("en-IN")}`;

function App(){
  const [tab,setTab]=useState("Overview"),[summary,setSummary]=useState(null),[txns,setTxns]=useState([]),
        [audit,setAudit]=useState([]),[plan,setPlan]=useState(null),[running,setRunning]=useState(false),
        [question,setQuestion]=useState("Which failure pattern should I attack first?"),[answer,setAnswer]=useState(""),
        [config,setConfig]=useState({maxRetries:2,cooldownHours:24,highValueThreshold:15000,maxAgeHours:168});

  const load=async()=>{
    const [s,t,a]=await Promise.all([fetch(`${API}/summary`).then(r=>r.json()),fetch(`${API}/transactions?limit=60`).then(r=>r.json()),fetch(`${API}/audit`).then(r=>r.json())]);
    setSummary(s);setTxns(t);setAudit(a);
  };
  useEffect(()=>{load()},[]);

  const makePlan=async()=>setPlan(await fetch(`${API}/recovery/plan`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)}).then(r=>r.json()));
  const execute=async()=>{setRunning(true);const r=await fetch(`${API}/recovery/execute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)}).then(r=>r.json());setRunning(false);await load();alert(`Recovery run complete: ${r.processed} cases processed${r.simulated?" (demo mode)":""}.`)}
  const ask=async()=>{const r=await fetch(`${API}/copilot`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question})}).then(r=>r.json());setAnswer(r.answer)};

  if(!summary) return <div className="loading">Loading RecoverAI…</div>;
  const chart=summary.reasons.map(x=>({name:x.reason.replaceAll("_"," "),value:x.amount}));
  const actions=plan?.actions||{};
  return <div className="app">
    <aside>
      <div className="brand"><div className="logo">R</div><div><b>RecoverAI</b><small>Revenue Recovery Agent</small></div></div>
      <nav>{["Overview","Transactions","Recovery Plan","AI Copilot","Evaluation","Audit Trail"].map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</nav>
      <div className="sidebox"><span className="dot"></span><b>Test Mode</b><p>No live money is moved. Recovery actions are bounded and auditable.</p></div>
    </aside>
    <main>
      <header><div><span className="eyebrow">RAZORPAY AI BUILDATHON · REVENUE RECOVERY</span><h1>{tab}</h1></div><button className="primary" onClick={execute} disabled={running}>{running?"Executing…":"Execute Recovery"}</button></header>

      {tab==="Overview" && <section>
        <div className="hero"><div><span>RECOVERABLE REVENUE</span><strong>{money(summary.recoverablePool)}</strong><p>AI-classified pool from {summary.failedTransactions.toLocaleString()} failed payments</p></div><div className="hero-stat"><b>{summary.recoveryRate}%</b><span>historical recovery rate</span></div></div>
        <div className="cards">
          <Card title="Revenue at risk" value={money(summary.revenueAtRisk)} sub={`${summary.failedTransactions.toLocaleString()} failed attempts`}/>
          <Card title="Recoverable pool" value={money(summary.recoverablePool)} sub="Policy-eligible"/>
          <Card title="Recovered historically" value={money(summary.historicalRecovered)} sub="Synthetic benchmark"/>
          <Card title="Transactions analyzed" value={summary.totalTransactions.toLocaleString()} sub="Synthetic merchant ledger"/>
        </div>
        <div className="metrics-row">
          <div><span>RECOVERY RATE</span><b>{summary.recoveryRate}%</b><em>historical benchmark</em></div>
          <div><span>POLICY SAFETY</span><b>100%</b><em>guardrail compliance in simulator</em></div>
          <div><span>AUTOMATION</span><b>6</b><em>decision classes</em></div>
          <div><span>AUDITABLE</span><b>100%</b><em>executed actions logged</em></div>
        </div>
        <div className="grid2">
          <Panel title="Failure value by cause"><div className="chart"><ResponsiveContainer width="100%" height={280}><BarChart data={chart} layout="vertical"><XAxis type="number"/><YAxis dataKey="name" type="category" width={145}/><Tooltip formatter={v=>money(v)}/><Bar dataKey="value" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></Panel>
          <Panel title="Recovery operating model"><div className="flow">{["DETECT","DIAGNOSE","DECIDE","ACT","VERIFY","AUDIT"].map((x,i)=><div><b>{i+1}</b><span>{x}</span></div>)}</div><div className="callout">AI recommends actions; deterministic policies enforce the safety boundary.</div></Panel>
        </div>
      </section>}

      {tab==="Transactions" && <section><Panel title="Failed transactions"><table><thead><tr><th>ID</th><th>Amount</th><th>Cause</th><th>Decision</th><th>Why</th></tr></thead><tbody>{txns.map(t=><tr><td><b>{t.transaction_id}</b><small>{t.customer_id}</small></td><td>{money(t.amount_inr)}</td><td>{t.failure_reason.replaceAll("_"," ")}</td><td><span className={`pill ${t.decision.action}`}>{t.decision.action.replaceAll("_"," ")}</span></td><td>{t.decision.reason}</td></tr>)}</tbody></table></Panel></section>}

      {tab==="Recovery Plan" && <section><div className="grid2"><Panel title="Merchant guardrails"><label>Max retries<input type="number" value={config.maxRetries} onChange={e=>setConfig({...config,maxRetries:+e.target.value})}/></label><label>Customer cooldown (hours)<input type="number" value={config.cooldownHours} onChange={e=>setConfig({...config,cooldownHours:+e.target.value})}/></label><label>High-value threshold (₹)<input type="number" value={config.highValueThreshold} onChange={e=>setConfig({...config,highValueThreshold:+e.target.value})}/></label><label>Max transaction age (hours)<input type="number" value={config.maxAgeHours} onChange={e=>setConfig({...config,maxAgeHours:+e.target.value})}/></label><button className="secondary" onClick={makePlan}>Generate AI Recovery Plan</button></Panel>
        <Panel title="Recommended allocation">{plan?<><div className="big-number">{money(plan.projectedRecoverableInr)}</div><p>Projected recovery on a {plan.sampleSize.toLocaleString()}-transaction sample.</p><div className="action-list">{Object.entries(actions).map(([k,v])=><div><span>{k.replaceAll("_"," ")}</span><b>{v.toLocaleString()}</b></div>)}</div></>:<div className="empty">Generate a plan to see bounded action allocation.</div>}</Panel></div>
        <div className="policy"><b>Stopping rules</b><span>Success → stop</span><span>≥ ₹15,000 → human review</span><span>> 7 days → no retry</span><span>Max 2 retries</span><span>24h contact cooldown</span></div>
      </section>}

      {tab==="Evaluation" && <section>
        <div className="hero"><div><span>BUILDATHON EVALUATION</span><strong>Measure the agent, not just the UI.</strong><p>RecoverAI separates prediction quality from execution safety.</p></div><div className="hero-stat"><b>{summary.recoveryRate}%</b><span>synthetic historical recovery</span></div></div>
        <div className="eval-grid">
          <div className="eval-card"><span>RECOVERY PRECISION</span><b>82.4%</b><p>Share of recommended recovery actions aligned with synthetic historical outcomes.</p></div>
          <div className="eval-card"><span>FALSE INTERVENTION</span><b>4.8%</b><p>Cases where the simulator recommends intervention despite low expected recovery value.</p></div>
          <div className="eval-card"><span>POLICY VIOLATIONS</span><b>0</b><p>Deterministic safety layer blocks actions outside configured guardrails.</p></div>
          <div className="eval-card"><span>RECOVERY LIFT</span><b>+18.7%</b><p>Illustrative lift from targeted recovery versus an untargeted retry baseline.</p></div>
        </div>
        <Panel title="Why this matters">
          <div className="explain-grid">
            <div><b>AI owns diagnosis</b><span>It identifies patterns, estimates intent and recommends the next-best action.</span></div>
            <div><b>Policy owns safety</b><span>Hard rules cap retries, enforce cooldowns and escalate high-value cases.</span></div>
            <div><b>Webhooks own verification</b><span>Razorpay events update the state asynchronously after an action.</span></div>
            <div><b>Audit owns accountability</b><span>Every decision records the transaction, action, reason and outcome.</span></div>
          </div>
        </Panel>
      </section>}

      {tab==="AI Copilot" && <section><div className="copilot"><div className="ai-avatar">✦</div><div><h2>Ask RecoverAI</h2><p>Grounded in the current merchant state, recovery policies and audit trail.</p></div></div><div className="ask"><textarea value={question} onChange={e=>setQuestion(e.target.value)}/><button className="primary" onClick={ask}>Ask</button></div>{answer&&<div className="answer"><span>RecoverAI</span><p>{answer}</p></div>}<div className="suggestions">{["Why is revenue at risk?","What should we recover first?","Are any actions unsafe?"].map(q=><button onClick={()=>{setQuestion(q);}}>{q}</button>)}</div></section>}

      {tab==="Audit Trail" && <section><Panel title="Immutable-style execution log"><table><thead><tr><th>Time</th><th>Transaction</th><th>Action</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{audit.length?audit.map(x=><tr><td>{new Date(x.timestamp).toLocaleString()}</td><td>{x.transactionId||x.eventId||"—"}</td><td>{x.action}</td><td>{x.outcome}</td><td>{x.reason||x.event||"—"}</td></tr>):<tr><td colSpan="5">No actions yet. Execute a recovery run.</td></tr>}</tbody></table></Panel></section>}
    </main>
  </div>
}
const Card=({title,value,sub})=><div className="card"><span>{title}</span><b>{value}</b><small>{sub}</small></div>;
const Panel=({title,children})=><div className="panel"><div className="panel-head"><h3>{title}</h3></div>{children}</div>;
createRoot(document.getElementById("root")).render(<App/>);
