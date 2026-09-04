import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { closeDialog, openDialog } from "../../lib/dialog";

interface PolicyDialogProps {
  open: boolean;
  kind: "privacy" | "livestream";
  version: string;
  onClose: () => void;
}

export function PolicyDialog({ open, kind, version, onClose }: PolicyDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) openDialog(dialog);
    if (!open && dialog.open) closeDialog(dialog);
  }, [open]);

  return (
    <dialog ref={ref} className="policy-dialog" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <span className="dialog-kicker">{kind === "privacy" ? "隐私说明" : "直播展示"}</span>
          <h2>{kind === "privacy" ? "隐私政策" : "直播公开展示说明"}</h2>
        </div>
        <button type="button" className="icon-button" onClick={() => ref.current && closeDialog(ref.current)} aria-label="关闭">
          <X aria-hidden="true" weight="bold" />
        </button>
      </div>
      <div className="policy-content">
        {kind === "privacy" ? <PrivacyContent version={version} /> : <LivestreamContent />}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button button--primary" onClick={() => ref.current && closeDialog(ref.current)}>
          我知道了
        </button>
      </div>
    </dialog>
  );
}

function PrivacyContent({ version }: { version: string }) {
  return (
    <>
      <p>本服务由<strong>鲲鹏无限科技有限公司</strong>运营，用于接收和处理直播观众的产品问题、反馈、投诉与建议。</p>
      <h3>我们收集哪些信息</h3>
      <p>我们会收集你的抖音昵称、中国大陆手机号、留言主题与内容、你主动上传的图片、两项同意记录，以及保障服务安全所必需的网络和操作日志。未提交的文字与图片草稿仅保存在你的浏览器中。</p>
      <h3>这些信息如何使用</h3>
      <p>手机号仅用于短信验证、建立昵称绑定、查询你的留言和必要的安全防护；留言及图片用于问题处理、产品改进和直播回复。手机号不会进入直播或其他公开展示数据。</p>
      <h3>直播与公开展示</h3>
      <p>正式提交后，你的抖音昵称、留言文字和提交内容可能在公司直播中被公开展示和回复。我们不会公开你的手机号。</p>
      <h3>服务提供方</h3>
      <p>为提供本服务，我们会使用 Cloudflare 的计算、数据库、对象存储、图片处理和安全能力，并使用中国大陆短信服务商完成验证码发送。上述服务方仅在提供服务所必需的范围内处理信息。</p>
      <h3>图片与安全</h3>
      <p>图片会在你的设备上压缩，并在服务器端再次验证和重编码，以移除位置、设备、拍摄时间等不必要的 EXIF 元数据。我们使用加密、访问控制、私有存储与访问限制保护信息。</p>
      <h3>保存与联系</h3>
      <p>我们仅在完成留言处理、履行法定义务和维护安全所必需的期限内保存信息。如需查询、更正或行使其他个人信息权利，请通过本服务所属的抖音直播间官方账号联系我们。</p>
      <p className="policy-meta">版本及生效日期：{version}</p>
    </>
  );
}

function LivestreamContent() {
  return (
    <>
      <p>所有正式提交的留言都会进入公司的直播处理流程。</p>
      <p>你提交的<strong>抖音昵称、留言文字、留言主题和图片等内容</strong>，可能在鲲鹏无限科技有限公司的直播中公开展示，并由主播或工作人员现场回复。</p>
      <p>请不要在留言或图片中放入身份证号、住址、银行卡、私人联系方式等不希望公开的信息。你的手机号只用于验证、绑定和留言查询，<strong>不会出现在直播或公开展示数据中</strong>。</p>
    </>
  );
}
