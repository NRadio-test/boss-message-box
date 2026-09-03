export interface Env {
  BOSS_MESSAGE_DB: D1Database;
  BOSS_MESSAGE_IMAGES: R2Bucket;
  IMAGES: ImagesBinding;
  APP_ENV: "development" | "production" | "test";
  SMS_PROVIDER: "mock" | "alibaba";
  DEV_OTP_CODE?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_EXPECTED_HOSTNAMES?: string;
  PRIVACY_POLICY_VERSION: string;
  LIVESTREAM_POLICY_VERSION: string;
  PHONE_HASH_KEY: string;
  PHONE_ENCRYPTION_KEY: string;
  OTP_HMAC_KEY: string;
  RATE_LIMIT_HMAC_KEY: string;
  ALIBABA_ACCESS_KEY_ID?: string;
  ALIBABA_ACCESS_KEY_SECRET?: string;
  ALIBABA_SMS_SIGN_NAME?: string;
  ALIBABA_SMS_TEMPLATE_CODE?: string;
}
