import { afterEach, describe, expect, it, vi } from "vitest";
import { createRandomUuid } from "../../src/lib/random-id";

afterEach(() => vi.unstubAllGlobals());

describe("browser random UUID compatibility", () => {
  it("uses the native implementation when it is available", () => {
    const nativeUuid = "b2ab3a3b-9ea0-4b08-a31d-d53c98889519";
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => nativeUuid),
      getRandomValues: vi.fn(),
    });

    expect(createRandomUuid()).toBe(nativeUuid);
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });

  it("creates an RFC 4122 version 4 UUID when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint8Array) => {
        values.set(Array.from({ length: 16 }, (_, index) => index));
        return values;
      },
    });

    expect(createRandomUuid()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("does not replace secure randomness with Math.random", () => {
    vi.stubGlobal("crypto", {});
    const mathRandom = vi.spyOn(Math, "random");

    expect(() => createRandomUuid()).toThrow("当前浏览器不支持安全随机数");
    expect(mathRandom).not.toHaveBeenCalled();
  });
});
