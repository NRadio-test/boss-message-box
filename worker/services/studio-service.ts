import {
  type StudioFeedbackDetailSuccess,
  type StudioFeedbackListSuccess,
  type StudioFeedbackView,
  type StudioNewFeedbackCountSuccess,
  type StudioPhoneRevealSuccess,
  type StudioReplyCreateSuccess,
  type StudioReplyType,
  type StudioSearchSuccess,
  type StudioSnapshot,
  type StudioStatsSuccess,
  type StudioTodoSuccess,
  type StudioUserDetailSuccess,
} from "../../src/shared/studio-contracts";
import { phoneSchema, type Topic } from "../../src/shared/contracts";
import { PublicError } from "../core/errors";
import type {
  PrivateImageReader,
  StudioRepository,
  StudioSessionRecord,
} from "../core/studio-ports";
import type { PhoneCryptoService } from "../core/ports";

const MACAU_OFFSET_MS = 8 * 60 * 60 * 1000;

function macauDayStartedAt(now: number): number {
  const shifted = new Date(now + MACAU_OFFSET_MS);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    MACAU_OFFSET_MS
  );
}

export class StudioService {
  constructor(
    private readonly dependencies: {
      studio: StudioRepository;
      images: PrivateImageReader;
      phoneCrypto: PhoneCryptoService;
    },
  ) {}

  list(input: {
    view: StudioFeedbackView;
    topic: Topic | null;
    page: number;
    snapshot: StudioSnapshot | null;
  }): Promise<StudioFeedbackListSuccess> {
    return this.dependencies.studio.listFeedbacks(input);
  }

  async search(input: {
    query: string;
    page: number;
    snapshot: StudioSnapshot | null;
  }): Promise<StudioSearchSuccess> {
    const phone = phoneSchema.safeParse(input.query);
    if (phone.success) {
      return {
        ...(await this.dependencies.studio.searchFeedbacks({
          queryType: "phone",
          queryValue: await this.dependencies.phoneCrypto.hash(phone.data),
          page: input.page,
          snapshot: input.snapshot,
        })),
        queryType: "phone",
      };
    }
    if (/^[0-9a-f]{8}$/iu.test(input.query)) {
      return {
        ...(await this.dependencies.studio.searchFeedbacks({
          queryType: "feedback_number",
          queryValue: input.query.toUpperCase(),
          page: input.page,
          snapshot: input.snapshot,
        })),
        queryType: "feedback_number",
      };
    }
    return {
      ...(await this.dependencies.studio.searchFeedbacks({
        queryType: "nickname",
        queryValue: input.query.normalize("NFC"),
        page: input.page,
        snapshot: input.snapshot,
      })),
      queryType: "nickname",
    };
  }

  async feedback(feedbackId: string): Promise<StudioFeedbackDetailSuccess> {
    const item = await this.dependencies.studio.findFeedback(feedbackId);
    if (!item) throw new PublicError(404, "NOT_FOUND", "留言不存在");
    return { ok: true, item };
  }

  async reply(input: {
    feedbackId: string;
    requestedType?: StudioReplyType;
    content: string;
    session: StudioSessionRecord;
    now: number;
  }): Promise<StudioReplyCreateSuccess> {
    const replyType = input.session.mode === "live" ? "live" : input.requestedType;
    if (!replyType) throw new PublicError(400, "VALIDATION_ERROR", "请选择回复方式");
    const result = await this.dependencies.studio.appendReply({
      id: crypto.randomUUID(),
      feedbackId: input.feedbackId,
      replyType,
      content: input.content,
      admin: input.session.admin,
      now: input.now,
    });
    if (!result) throw new PublicError(404, "NOT_FOUND", "留言不存在");
    return {
      ok: true,
      ...result,
      status: "replied",
      isTodo: false,
    };
  }

  async todo(input: {
    feedbackId: string;
    isTodo: boolean;
    session: StudioSessionRecord;
    now: number;
  }): Promise<StudioTodoSuccess> {
    if (input.session.mode === "live") {
      throw new PublicError(403, "FORBIDDEN", "直播展示模式不能修改待办");
    }
    const isTodo = await this.dependencies.studio.setTodo({
      feedbackId: input.feedbackId,
      isTodo: input.isTodo,
      adminId: input.session.admin.id,
      now: input.now,
    });
    if (isTodo === null) throw new PublicError(404, "NOT_FOUND", "留言不存在");
    return { ok: true, isTodo };
  }

  async user(userId: string): Promise<StudioUserDetailSuccess> {
    const result = await this.dependencies.studio.findUser(userId);
    if (!result) throw new PublicError(404, "NOT_FOUND", "用户不存在");
    return result;
  }

  async revealPhone(
    userId: string,
    session: StudioSessionRecord,
  ): Promise<StudioPhoneRevealSuccess> {
    if (session.mode === "live") {
      throw new PublicError(403, "FORBIDDEN", "直播展示模式不能查看完整手机号");
    }
    const encrypted = await this.dependencies.studio.findEncryptedPhone(userId);
    if (!encrypted) throw new PublicError(404, "NOT_FOUND", "用户不存在");
    const canonical = await this.dependencies.phoneCrypto.decrypt(
      encrypted.phoneEncrypted,
      encrypted.phoneHash,
    );
    if (!/^\+861[3-9]\d{9}$/u.test(canonical)) {
      throw new Error("Stored phone number is invalid");
    }
    return { ok: true, phone: canonical.slice(3) };
  }

  async stats(now: number): Promise<StudioStatsSuccess> {
    return { ok: true, ...(await this.dependencies.studio.getStats(macauDayStartedAt(now))) };
  }

  async newFeedbackCount(
    after: StudioSnapshot,
    topic: Topic | null,
  ): Promise<StudioNewFeedbackCountSuccess> {
    return { ok: true, count: await this.dependencies.studio.countNewFeedback(after, topic) };
  }

  async image(feedbackId: string, imageId: string): Promise<{
    body: ReadableStream;
    size: number;
    etag: string;
  }> {
    const reference = await this.dependencies.studio.findImage(feedbackId, imageId);
    if (!reference) throw new PublicError(404, "NOT_FOUND", "图片不存在");
    const object = await this.dependencies.images.getPrivate(reference.objectKey);
    if (!object) throw new PublicError(404, "NOT_FOUND", "图片不存在");
    return object;
  }
}
