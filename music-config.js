// 音乐点播配置：改这里就能换歌单、换接口，不需要动 app.js。
window.DASHBOARD_MUSIC_CONFIG = {
  // Meting 聚合接口（搜索/播放地址解析都走它；失效时可换成其他公共镜像或自建 Meting）
  metingApi: 'https://api.i-meto.com/meting/api',
  // 默认展示的网易云歌单（需公开歌单；数字 ID 可从歌单分享链接里复制）
  neteasePlaylistId: '412169151',
  neteasePlaylistName: '宝珠爱吃糖喜欢的音乐'
};
