import { ArrowClockwise, Plus, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/Button";
import { createRandomUuid } from "../../lib/random-id";
import { kindLabels, loadCustom, storageKey, targetError, type Kind, type Method, type Result, type Target } from "./probe";
import { presets } from "./targets";
import { TargetRow } from "./TargetRow";
import { useProbes } from "./use-probes";
import "./iptest.css";

export function IpTestPage() {
  const [custom, setCustom] = useState(loadCustom);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [view, setView] = useState<"ip" | "site">("ip");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<Method>("site");
  const [path, setPath] = useState("/");
  const [error, setError] = useState("");
  const [storageNote, setStorageNote] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const domainInput = useRef<HTMLInputElement>(null);
  const { results, running, lastRun, run, stop, remove } = useProbes([...presets, ...custom].filter((target) => target.method !== "site"));
  const targets = [...presets, ...custom];
  const selected = targets.filter((target) => view === "ip" ? target.method !== "site" : target.method === "site");
  const term = search.trim().toLowerCase();
  const visible = selected.filter((target) => (filter === "all" || target.kind === filter)
    && `${target.name} ${target.domain} ${results[target.id]?.ip || ""}`.toLowerCase().includes(term));
  const values = selected.map((target) => results[target.id]);
  const completed = values.filter((result) => result && !["queued", "loading", "stopped"].includes(result.status)).length;
  const count = (statuses: Result["status"][]) => values.filter((result) => result && statuses.includes(result.status)).length;

  useEffect(() => {
    const previous = document.title;
    document.title = "分流测试 · 张导请回答";
    return () => { document.title = previous; };
  }, []);
  useEffect(() => { if (adding) domainInput.current?.focus(); }, [adding]);

  function save(next: Target[]) {
    setCustom(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageNote(""); }
    catch { setStorageNote("浏览器无法保存自定义站点，刷新后更改会丢失。"); }
  }
  function closeForm() { setAdding(false); setError(""); addButton.current?.focus(); }
  function addTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;
    const form = new FormData(event.currentTarget);
    const domain = String(form.get("domain") || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const target: Target = { id: `custom-${createRandomUuid()}`, name: String(form.get("name") || "").trim() || domain,
      domain, path: path.trim(), method, kind: "custom" };
    const validation = targetError(target);
    if (validation) { setError(validation); return; }
    if (custom.length >= 30) { setError("最多添加 30 个自定义站点。"); return; }
    if (targets.some((item) => item.domain === domain && item.path === target.path && item.method === method)) {
      setError("这个站点已在列表中。"); return;
    }
    save([...custom, target]);
    setView(method === "site" ? "site" : "ip"); setFilter("custom"); setSearch(""); closeForm();
    void run([target]);
  }

  return <AppShell networkTool>
    <div className="iptest-page">
      <header className="page-intro">
        <div className="signal-caption"><span aria-hidden="true" />网络工具</div>
        <h1>分流测试</h1>
        <p>查看不同站点的出口 IP、归属地与运营商。</p>
      </header>
      <section className="iptest-panel" aria-labelledby="iptest-results-title">
        <div className="iptest-panel-heading">
          <div><h2 id="iptest-results-title">{view === "ip" ? "出口 IP" : "网站响应"}</h2><p>{view === "ip" ? "切换代理或网络后，重新检测即可对比。" : "这些站点未提供可读取的出口 IP 接口。"}</p></div>
          <div className="iptest-actions">
            <button ref={addButton} className="button button--secondary" type="button" disabled={running}
              aria-expanded={adding} aria-controls="iptest-add" onClick={() => adding ? closeForm() : setAdding(true)}>
              <Plus aria-hidden="true" /><span>添加站点</span>
            </button>
            {running ? <Button variant="secondary" icon={<Stop aria-hidden="true" />} onClick={stop}>停止检测</Button>
              : <Button icon={<ArrowClockwise aria-hidden="true" />} onClick={() => void run(selected)}>{completed ? "重新检测" : "开始检测"}</Button>}
          </div>
        </div>
        <form id="iptest-add" className="iptest-add" hidden={!adding} onSubmit={addTarget}>
          <div className="iptest-form-grid">
            <label>目标域名<input ref={domainInput} name="domain" required maxLength={253} placeholder="example.com" autoComplete="off" spellCheck={false} aria-describedby={error ? "iptest-form-error" : undefined} /></label>
            <label>显示名称（选填）<input name="name" maxLength={40} placeholder="我的网站" /></label>
            <label>检测方式<select value={method} onChange={(event) => {
              const next = event.target.value as Method; setMethod(next); setPath(next === "trace" ? "/cdn-cgi/trace" : "/");
            }}><option value="site">网站响应</option><option value="trace">Cloudflare Trace</option><option value="echo">IP 回显接口</option></select></label>
            <label>接口路径<input value={path} onChange={(event) => setPath(event.target.value)} required maxLength={512} spellCheck={false} /></label>
          </div>
          <p className="iptest-note">查询出口 IP 需要目标站点提供相应接口。</p>
          {error && <p id="iptest-form-error" className="iptest-error" role="alert">{error}</p>}
          <div className="iptest-actions"><Button variant="quiet" type="button" onClick={closeForm}>取消</Button><Button type="submit" disabled={running}>添加并检测</Button></div>
        </form>
        {storageNote && <p className="iptest-note" role="status">{storageNote}</p>}
        <div className="iptest-views" role="group" aria-label="检测内容">
          <button type="button" disabled={running} aria-pressed={view === "ip"} onClick={() => { setView("ip"); setFilter("all"); }}>出口 IP <span>{targets.filter((t) => t.method !== "site").length}</span></button>
          <button type="button" disabled={running} aria-pressed={view === "site"} onClick={() => { setView("site"); setFilter("all"); }}>网站响应 <span>{targets.filter((t) => t.method === "site").length}</span></button>
        </div>
        <div className="iptest-summary">
          <p role="status">{running ? `检测中 ${completed} / ${selected.length}` : count(["stopped"]) ? "检测已停止" : completed ? "检测完成" : "准备就绪"}
            {lastRun && completed > 0 && !running && <span>上次完成 {lastRun}</span>}</p>
          <dl><div><dt>获取 IP</dt><dd>{count(["ok"])}</dd></div>{view === "site" && <div><dt>网站响应</dt><dd>{count(["responded"])}</dd></div>}<div><dt>未获取结果</dt><dd>{count(["unavailable", "timeout"])}</dd></div></dl>
        </div>
        <div className="iptest-toolbar">
          <div className="iptest-filters" role="group" aria-label="筛选站点">
            {(Object.keys(kindLabels) as (Kind | "all")[]).filter((kind) => kind === "all" || kind === "custom" || selected.some((target) => target.kind === kind)).map((kind) => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kindLabels[kind]}</button>)}
          </div>
          <label className="iptest-search"><span className="sr-only">搜索站点或 IP</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索站点或 IP" /></label>
        </div>
        <div className="iptest-table-wrap">
          <table className="iptest-table"><caption className="sr-only">站点出口 IP 与连接状态</caption>
            <thead><tr><th scope="col">网站 / 域名</th><th scope="col">地区</th><th scope="col">出口 IP</th><th scope="col" title="本次浏览器请求耗时，不含排队和归属地查询；并非 Ping 延迟。">响应耗时</th><th scope="col">归属地 / 运营商</th><th scope="col">操作</th></tr></thead>
            <tbody>{visible.map((target) => <TargetRow key={target.id} target={target} result={results[target.id]} running={running}
              onRetry={() => void run([target])} onRemove={() => { save(custom.filter((item) => item.id !== target.id)); remove(target.id); }} />)}</tbody>
          </table>
          {!visible.length && <p className="iptest-empty">{filter === "custom" && !custom.length ? "还没有自定义站点，可以点击上方添加。" : "没有匹配的站点，试试其他关键词。"}</p>}
        </div>
        <p className="iptest-table-note">{visible.length} 个站点<span>出口按站点独立检测 · 归属地由 IP.SB / IPinfo 提供</span></p>
      </section>
      <details className="iptest-help"><summary>检测说明</summary>
        <p>请求由当前浏览器直接发往列表中的站点。出口 IP 仅代表对应站点的这次请求；网站响应可能包含跳转或访问受限。</p>
        <p>响应耗时是本次检测从开始请求到取得结果的时间，不含排队和归属地查询。它会受到连接建立、代理、服务器处理和浏览器执行的影响，并非 Ping 延迟；不同接口的耗时不宜直接等同比较。点击单行重测可再次测量。</p>
        <p>无法读取可能是跨域限制或网络问题，可点击“打开核对”，并在代理客户端查看命中规则。归属地由查询服务提供，仅供参考。腾讯、阿里和字节等项目检测所列节点，不代表旗下所有产品。</p>
        <p>为补全归属地，检测到的出口 IP 会经本站发送至归属地服务。自定义站点仅保存在此浏览器。</p>
      </details>
    </div>
  </AppShell>;
}
