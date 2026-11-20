/*
 * 颱風應變檢核清單｜設定（這個檔案任何人都看得到，不要放密碼）
 *
 * TC_AUTH.clientId：Google Cloud 的「OAuth 用戶端 ID」（網頁應用程式類型），是公開資訊。
 *   目前借用「倉儲 IT 整合中心」的用戶端 ID：同樣放在 cheesedukead4.github.io 底下，登入一樣能用，
 *   差別只是 Google 登入視窗會顯示那個 App 的名稱。雲端後端（雲端後端/Code.gs）的 GOOGLE_CLIENT_ID_ 要填同一個 ID。
 * TC_CLOUD.url：本 App 的 Apps Script 網頁應用程式網址（結尾 /exec），見「使用說明.md」。
 *
 * 兩個都填了＝雲端版（Google 登入、大家共用進度）；雲端網址空白＝單機版（資料只存在各自的裝置）。
 */
window.TC_AUTH = {
  clientId: '108931232819-5iv3i1uf96nhq0ihlbtq9thh17em2jn8.apps.googleusercontent.com'
};

window.TC_CLOUD = {
  url: ''
};
