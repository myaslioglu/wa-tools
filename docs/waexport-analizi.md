# WAexport eklentisinin incelenmesi (arka plan)

WhatsApp Tools, “WAexport: Export WA Chats and Contacts” (Chrome Web Mağazası kimliği
`jndgjmiigkfgngemhobhnibilojkkfhi`, sürüm 5.1.1.1) eklentisinin nasıl çalıştığı
incelendikten sonra **bağımsız olarak** yazıldı. Bu depoda o eklentinin kodu yoktur;
aşağıdakiler incelemenin bulgularıdır (24.10.2026).

## Yöntem

1. `.crx` dosyası açıldı (CRX3 başlığı atlanıp içteki ZIP çıkarıldı; 206 dosya).
2. [REA](https://github.com/morluto/rea) ile statik analiz:

   ```bash
   npx rea-agents analyze-javascript-application /yol/acilmis-eklenti --json
   ```

   47 dosya, 39 JavaScript ayrıştırıldı (≈2 dk). REA'nın Chrome eklentisine özel bir
   çözümleyicisi yok; eklentiyi Electron uygulaması gibi ele aldı (HTML sayfalarını
   “electron-renderer” diye etiketledi). Yararlı çıktısı, koddaki uzak uç noktaları
   kanıtıyla listelemesi oldu.
3. Asıl mekanizma küçültülmüş kaynak kod okunarak çıkarıldı.

## Bulgular

| Konu | Gözlem |
| --- | --- |
| Erişim | İçerik betiği, sayfaya `<script>` olarak modüller enjekte ediyor; bunlar WhatsApp Web'in kendi modül sistemini (`window.require("WAWebCollections")` vb.) kullanıyor. Bu katman açık kaynak whatsapp-web.js'in Store/Utils kodundan türetilmiş (`waex`, `WWebJSwaex` adlarıyla). |
| Mesaj geçmişi | `WAWebChatLoadMessages.loadEarlierMsgs({ chat, msgCollection })`; ek olarak sohbet açılıp arayüzdeki “Click here…” düğmesine basılarak telefondan eski mesaj isteniyor. |
| Medya | `WAWebDownloadManager.downloadManager.downloadAndMaybeDecrypt({ directPath, encFilehash, filehash, mediaKey, mediaKeyTimestamp, type, signal })`, önce `WAWebMediaInMemoryBlobCache` denetleniyor. |
| Çıktılar | JSZip (ZIP), html2pdf (PDF), SheetJS (XLSX), CSV/TXT. |
| Uzak yapılandırma | Kullanılacak iç modül adları `…lambda-url.eu-north-1.on.aws/user/get-license-data` adresinden şifreli alınıyor (AES-CBC, anahtar = lisans anahtarının SHA-256'sı, varsayılan anahtar `waexport--`). Sunucuya ulaşılamazsa dışa aktarma çalışmıyor. |
| Lisans denetimi | Her dışa aktarmadan önce `…/user/verify-wa-export` adresine **kullanıcının telefon numarası** ve seçili kişi sayısı gönderiliyor. |
| Kullanım kaydı | `…/user/log-data` adresine dışa aktarma ayarları ve telefon numarası gönderiliyor (seçili kişi listeleri gönderilmeden önce siliniyor). |
| İzinler | `storage`, `tabs`, `sidePanel`; içerik betiği yalnızca `https://web.whatsapp.com/`. |

## WhatsApp Tools'taki tasarım kararları

- Uzak sunucu, lisans ve kullanım kaydı yok; eklenti hiçbir ağ isteği yapmaz.
- WhatsApp iç yapısına dokunan tek katman `extension/page/wa.js`; modül adları yerel.
- Betikler `world: "MAIN"` içerik betiği olarak yüklenir (sayfaya `<script>` enjeksiyonu yok);
  izin olarak yalnızca `https://web.whatsapp.com/*`.
- Büyük arşivler için File System Access API ile doğrudan klasöre yazma; ZIP yalnızca yedek yol.
- Eksik geçmiş ve indirilemeyen medya çıktıda açıkça kaydedilir.
