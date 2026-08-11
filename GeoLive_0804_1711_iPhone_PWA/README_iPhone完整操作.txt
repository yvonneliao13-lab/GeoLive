GeoLive 0804.1348｜iPhone 完整 PWA 測試版
============================================

這一版是把目前電腦版的主要測試進度搬到 iPhone PWA：
- GPS 即時路線：Start / Pause / Resume / Finish
- 即時拍照並使用拍照當下 GPS
- 匯入 GPX＋照片，照片依 EXIF GPS 定位
- 多專案開啟、關閉、重新命名與完整刪除
- 照片不加外框、依 Zoom 縮小、低 Zoom 減少重疊
- 路徑地形剖面
- 縣市＋區／鄉鎮市下載 Zoom 15 離線圖磚
- 離線地圖管理、開啟、關閉、刪除
- GPX、KMZ、SHP/SHX/DBF/PRJ、照片與 project.json 打包 ZIP
- Service Worker 離線啟動
- 真實飛航模式網路狀態判斷

最快部署（Netlify Drop）
1. 解壓縮本 ZIP。
2. 在電腦瀏覽器打開 Netlify Drop。
3. 將「GeoLive_0804_1348_iPhone_PWA_FULL」資料夾拖入。
4. Netlify 會產生一個 https://...netlify.app 網址。
5. 用 iPhone Safari 開啟該網址。
6. Safari 分享 → 加入主畫面。
7. 從主畫面開啟 GeoLive，允許定位與相機。

iPhone 操作
1. 有網路時先開啟 App 一次，等待地圖與套件載入。
2. 左上選單 → 下載離線地圖。
3. 選縣市及區／鄉鎮市，下載 Zoom 15。
4. 到管理離線地圖，按開啟並確認範圍。
5. 按 Start 開始記錄；Pause 暫停；Resume 繼續；Finish 存檔。
6. 相機按鈕可拍照。
7. 專案右側 ⋮ 可下載、改名、關閉或刪除。
8. 完整下載 ZIP 內含 GPX、KMZ、SHP、SHX、DBF、PRJ、照片及 JSON。

真正離線測試
1. 有網路時先下載離線地圖，且至少完整開啟 App 一次。
2. 勾選「模擬離線」。
3. iPhone 右上角向下滑 → 開啟飛航模式 → 確認 Wi‑Fi 關閉。
4. 回到 GeoLive，右上角應顯示「真正離線」。
5. 檢查已下載底圖、GPS、新專案與照片。
6. 測試完畢後關閉飛航模式。

重要限制
- Apple 不允許網頁或 PWA 自動關閉 Wi‑Fi、行動數據或飛航模式，必須手動操作。
- 行政區範圍使用 Nominatim 查詢；第一次下載該區域必須有網路。
- 大行政區的 Zoom 15 圖磚很多，下載時請保持畫面在前景並避免鎖屏。
- iOS 可能在儲存空間不足或長期未使用時清除網站資料；重要專案請下載 ZIP 備份。
- iPhone Safari 無法真正選取「資料夾」；匯入時請一次選取 GPX 與全部照片。
- SHP 為 WGS84 線圖層；照片位置保存在 KMZ 與 project.json 中。
