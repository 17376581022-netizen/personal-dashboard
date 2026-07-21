// Apple Music 的开发者令牌由 Supabase Edge Function 动态签发。
// 私钥只保存在 Supabase Secrets 中，绝不能写入这个文件或提交到 GitHub。
window.APPLE_MUSIC_CONFIG = Object.freeze({
  developerTokenEndpoint: 'https://xidybkskcanyvsmbkexa.supabase.co/functions/v1/apple-music-token',
  storefrontId: 'cn'
});
