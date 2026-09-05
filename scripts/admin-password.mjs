import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const username = args[args.indexOf("--username") + 1];
const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
if (!args.includes("--username") || !/^[A-Za-z0-9_-]{1,50}$/u.test(username ?? "") || !target || (args.includes("--remote") && args.includes("--local"))) {
  console.error("用法：pnpm run admin:password --username zd --local（线上数据库请明确使用 --remote）");
  process.exit(1);
}

function hiddenInput(prompt) {
  if (!process.stdin.isTTY) throw new Error("请在交互终端运行，密码不会显示或写入命令历史。");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003" || character === "\u0004") { finish(); reject(new Error("操作已取消")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

let directory;
try {
  console.log(`将为 ${target === "--remote" ? "线上" : "本地"}管理员 ${username} 设置密码，并注销该账号的所有会话。`);
  const password = await hiddenInput("新密码（12—200 字符，不回显）：");
  if (password.length < 12 || password.length > 200) throw new Error("密码长度必须为 12—200 字符");
  if (password !== await hiddenInput("再次输入新密码：")) throw new Error("两次密码不一致");
  const salt = randomBytes(16);
  const hash = `pbkdf2-sha256$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
  directory = mkdtempSync(join(tmpdir(), "studio-password-"));
  const sqlPath = join(directory, "reset.sql");
  writeFileSync(sqlPath, `UPDATE admins SET password_hash = '${hash}', must_change_password = 0, updated_at = ${Date.now()} WHERE username = '${username}' COLLATE NOCASE;
DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE username = '${username}' COLLATE NOCASE AND password_hash = '${hash}');`, { mode: 0o600 });
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "BOSS_MESSAGE_DB", target, "--file", sqlPath, "--json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("设置失败，请检查 Cloudflare 登录、数据库绑定及迁移是否完成。未输出可能包含密码散列的命令结果。");
  const results = JSON.parse(result.stdout);
  if (!Array.isArray(results) || results[0]?.meta?.changes !== 1) throw new Error("未修改账号，请核对用户名是否存在。");
  console.log("密码已设置，请使用新密码登录 Studio。");
} catch (error) {
  console.error(error instanceof SyntaxError ? "无法确认执行结果，请尝试用新密码登录，必要时重新设置。" : error.message);
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
