declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
  }
}
