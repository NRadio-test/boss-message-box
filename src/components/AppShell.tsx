import { ChatTeardropDots, NotePencil } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export function AppShell({ children, networkTool = false }: { children: ReactNode; networkTool?: boolean }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" reloadDocument={networkTool} className="brand" aria-label="张导请回答首页">
          <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
          <span>张导请回答</span>
        </NavLink>
        <nav className="primary-nav" aria-label="主要导航">
          <NavLink to="/" reloadDocument={networkTool} end>
            <NotePencil aria-hidden="true" weight="bold" />
            <span>提交留言</span>
          </NavLink>
          <NavLink to="/my" reloadDocument={networkTool}>
            <ChatTeardropDots aria-hidden="true" weight="bold" />
            <span>我的留言</span>
          </NavLink>
        </nav>
      </header>
      <main id="main-content">{children}</main>
      {!networkTool && <div className="site-utility"><a href="/iptest">分流测试</a></div>}
      <footer className="site-footer">
        <span>鲲鹏无限科技有限公司</span>
        {!networkTool && <><span aria-hidden="true">·</span>
        <span>请勿在留言中填写其他敏感信息</span></>}
      </footer>
    </div>
  );
}
