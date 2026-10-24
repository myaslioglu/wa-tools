# WhatsApp Tools — kişisel WhatsApp Web araçları (Chrome eklentisi)

Kendi kullanımınız için WhatsApp Web araçları. İlk araç **sohbet arşivi**: WhatsApp Web'deki
sohbetlerinizi **kendi bilgisayarınıza**, medyasıyla birlikte
dışa aktarır. Lisans sunucusu, hesap, telemetri yok; eklenti hiçbir ağ isteği
yapmaz (medya, WhatsApp Web'in kendi indirme/şifre çözme yolundan alınır).

## Kurulum (geliştirici modu)

1. Depoyu klonlayın veya indirin; `extension/` klasörü eklentinin kendisidir.
2. Chrome / Edge / Brave: `chrome://extensions` → sağ üstte **Geliştirici modu** açık.
3. **Paketlenmemiş öğe yükle** → `extension` klasörünü seçin.
   Güncellemeden sonra aynı sayfada eklentinin **↻ (yeniden yükle)** düğmesine basıp WhatsApp sekmesini yenileyin.
4. `https://web.whatsapp.com` açın, QR ile giriş yapın, sohbetlerin yüklenmesini bekleyin.
5. Araç çubuğundaki WhatsApp Tools simgesine tıklayın (veya **Alt+Shift+W**). Panel sağ üstte açılır.

Chrome 111 veya üstü gerekir (sayfa dünyasında içerik betiği için).

## Kullanım

- **Sohbetler:** arayın, filtreleyin (Bireysel / Gruplar / Arşivlenmiş), “Görünenleri seç”.
- **Tarih aralığı:** boş bırakılırsa tüm geçmiş yüklenir.
- **Biçimler:**
  - `sohbet.html` — WhatsApp görünümünde, aranabilir, medya gömülü, yanıtlar tıklanabilir.
  - `sohbet.txt` — WhatsApp'ın kendi dışa aktarmasına benzer satırlar.
  - `mesajlar.csv` — Excel için (UTF-8 BOM, varsayılan `;` ayırıcı).
  - `mesajlar.json` — eksiksiz ham kayıt (analiz, yedek, başka araçlara aktarım).
- **Medya:** fotoğraf, video, sesli mesaj, belge, çıkartma; türe göre seçilebilir.
- **Çıktı:**
  - *Klasöre yaz* (önerilir): dosyalar seçtiğiniz klasöre doğrudan yazılır; büyük arşivlerde bellek şişmez.
  - *ZIP indir*: tek dosya; en fazla 4 GB / 65.535 dosya.
- **Durdur:** o ana kadar aktarılanlar ve özet dosyası yine kaydedilir.

Çıktı yapısı:

```
WhatsApp-Arsiv_20261024_143000/
  index.html              ← tüm sohbetlerin listesi
  disa-aktarim.json       ← özet: seçenekler, her sohbetin durumu, eksikler
  Ayşe Yılmaz/
    sohbet.html  sohbet.txt  mesajlar.csv  mesajlar.json
    media/20260102_000000_ABCD1234.jpg …
```

## “Tam kapasite” için bilmeniz gerekenler

- WhatsApp Web, telefonunuzdaki geçmişin yalnızca bir kısmını tarayıcıya eşitler.
  Eklenti önce WhatsApp Web'in kendi “daha eski mesajları yükle” işlevini sonuna kadar
  çağırır. Daha eskisi yalnızca telefondaysa **Gelişmiş → Telefondaki eski mesajları da
  iste** seçeneği, sohbeti açıp WhatsApp'ın “eski mesajları telefondan al” düğmesine
  basar (deneysel; arayüze bağlı). Her sohbet için `history.complete` alanı geçmişin
  başına ulaşılıp ulaşılmadığını söyler; ulaşılamadıysa HTML başlığında ⚠ görünür.
- Eski medya WhatsApp sunucularında bir süre sonra silinir; indirilemeyen her dosya
  mesajın yanında gerekçesiyle belirtilir (sessizce atlanmaz).
- Dışa aktarılmayanlar: emoji tepkileri, anket oyları, görüldü bilgileri, kanallar ve durumlar.
- CSV'de `=`, `+`, `-`, `@` ile başlayan hücrelerin başına `'` eklenir (Excel formül
  enjeksiyonuna karşı). JSON dosyası metni değiştirmeden saklar.

## WhatsApp güncellendiğinde

WhatsApp Web'in iç modül adlarına (`WAWebCollections`, `WAWebChatLoadMessages`,
`WAWebDownloadManager` …) dayanan tek dosya `extension/page/wa.js`'dir. Bir güncellemeden sonra
sohbet listesi gelmez ya da medya inmezse yalnızca bu dosyadaki adlar/çağrı biçimleri
güncellenmelidir. İncelenen WAexport eklentisi bu adları lisans sunucusundan alıyor; burada
bilerek yerel tutuldu.

## Dosyalar

`extension/` altında:

| Dosya | Görev |
| --- | --- |
| `manifest.json` | MV3; tek izin `web.whatsapp.com` (içerik betiği için zaten gerekli). |
| `sw.js` | Araç çubuğu / kısayol → paneli aç-kapat. |
| `bridge.js` | Eklenti mesajını sayfa dünyasına ileten küçük köprü. |
| `page/wa.js` | WhatsApp Web iç yapısına erişen tek katman. |
| `page/exporter.js` | Geçmişi yükleme, medya indirme, dosya yazma akışı. |
| `page/formats.js` | HTML / TXT / CSV / JSON üretimi. |
| `page/sinks.js`, `page/zip.js` | Klasöre yazma ve ZIP oluşturma (harici kütüphane yok). |
| `page/panel.js`, `page/panel.css` | Sayfa içi panel. |

## Geliştirme ve test

Testler gerçek Chromium'da eklentiyi yükler, `https://web.whatsapp.com/` adresine
sahte bir WhatsApp Web (`test/mock-wa.js`) sunar, paneli kullanarak hem klasör hem
ZIP çıktısı üretir ve dosyaları denetler.

```bash
npm ci
npx playwright install chromium
npm test
```

Sahte sayfa yalnızca `page/wa.js`'in beklediği şekilleri taklit eder; testlerin
geçmesi gerçek WhatsApp Web'in bu şekilleri hâlâ sunduğunu kanıtlamaz. Gerçek
WhatsApp Web'de deneme elle yapılmalıdır.

Eklentinin nasıl tasarlandığına dair arka plan: [docs/waexport-analizi.md](docs/waexport-analizi.md).

## Uyarılar

- Kişisel kullanım içindir; yalnızca kendi hesabınızın verilerini dışa aktarın.
  Gruplardaki diğer kişilerin mesajları ve telefon numaraları da kişisel veridir.
- Eklenti WhatsApp'ın resmi bir API'sini değil, WhatsApp Web'in iç yapısını kullanır;
  WhatsApp güncellemeleriyle bozulabilir. Yalnızca okuma yapar, mesaj göndermez.
- Linux'ta Chrome UTF-8 olmayan bir yerel ayarla (`LANG=C`) çalışıyorsa Türkçe
  karakterli klasör adları hatalı oluşturulabilir; bu durumda *ZIP indir*'i kullanın.
