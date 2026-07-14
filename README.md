# İzlerken Öğren Player

Dil öğrenmeye odaklanan, yerel video ve haricî `.srt` altyazı açabilen Electron masaüstü oynatıcısı.

## Şu anda çalışan özellikler

- `.mp4`, `.mkv`, `.mov`, `.m4v` ve `.webm` dosyası seçme
- Chromium'un doğrudan çözemediği codec'lerde yerel FFmpeg ile H.264/AAC MP4 hazırlama
- Haricî `.srt` dosyası açma
- UTF-8, UTF-16 LE/BE ve yaygın Türkçe Windows metinleri için kodlama geri dönüşü
- Altyazıyı video zamanıyla senkron gösterme; video durduğunda altyazı ekranda kalır
- `T` tuşuyla yalnızca o saniyede görünen İngilizce altyazıyı çevrimiçi olarak Türkçeye çevirme
- İkinci `T` basışında çeviriyi gizleme
- Daha önce çevrilmiş cümleleri yerel cache'den tekrar gösterme
- Türkçe çevirideki bir kelimeye tıklayarak kalıcı öğrenme kütüphanesine kaydetme
- Seçilebilir ses çıkışı: sistem varsayılanı, kulaklık, DAC, hoparlör vb.
- Windows için kurulum `.exe`si ve taşınabilir `.exe` oluşturma komutları

## Çeviri sistemi

İlk sürüm, API anahtarı gerektirmeyen **MyMemory** çevrimiçi çeviri servisini kullanır. Bu nedenle yerel sözlük kurman gerekmez. `T` tuşuna basıldığında yalnızca ekrandaki aktif altyazı internete gönderilir.

Çevrilen cümleler `translation-cache.json` dosyasına kaydedilir. Aynı altyazı yeniden çevrildiğinde internet isteği yapılmadan cache kullanılır. Bu cache bir kelime sözlüğü değildir; daha önce istenmiş tam altyazı çevirilerini saklar.

MyMemory ücretsiz kullanım kotasına ve hizmet koşullarına tabidir. Daha sonra üretim sürümünde DeepL veya Google Cloud Translation gibi anahtarlı bir sağlayıcıya geçmek mantıklı olur.

## Öğrenme kütüphanesi

Tıklanan kelimeler şu konumda kalıcı olarak saklanır:

- Windows: `%APPDATA%\\izlerken-ogren-player\\learning-library.json`
- macOS: `~/Library/Application Support/izlerken-ogren-player/learning-library.json`
- Linux: `~/.config/izlerken-ogren-player/learning-library.json`

Her kayıt şunları içerir:

- Tıklanan Türkçe kelime
- Normalleştirilmiş kelime
- İngilizce altyazı cümlesi
- Türkçe çeviri cümlesi
- Video adı
- Altyazının başlangıç zamanı
- İlk ve son kayıt zamanı
- Aynı kelimenin kaç kez kaydedildiği
- Farklı cümle bağlamları

Üst çubuktaki **Kütüphane** düğmesi JSON dosyasını Dosya Gezgini/Finder içinde gösterir.

## Gereksinimler

- Windows 10/11, macOS veya güncel Linux dağıtımı
- Güncel Node.js LTS
- İlk `npm install` ve çevrimiçi çeviri için internet

## Kurulum

Proje klasöründe terminal aç:

```bash
npm install
npm start
```

Windows'ta ayrıca `KURULUM-VE-BASLAT.bat` dosyasına çift tıklayabilirsin.

## Kullanım

1. **Video Aç** ile videoyu seç.
2. **SRT Aç** ile İngilizce altyazıyı seç.
3. Videoyu oynat veya durdur.
4. Ekrandaki mevcut İngilizce altyazının çevirisini görmek için `T` tuşuna bas.
5. Sarı Türkçe çevirideki istediğin kelimeye tıkla.
6. Kelime kalıcı JSON kütüphanesine eklenir.
7. `T` tuşuna tekrar basarsan çeviri gizlenir.

`Space` oynatma/durdurma kısayoludur.

## Ses çıkışı

**Cihaz Seç** düğmesi Chromium/Electron ses çıkışı seçim penceresini açar. İzin verilen cihazlar daha sonra açılır listede görünür. Uygulama `HTMLMediaElement.setSinkId()` kullanarak yalnızca video sesini seçtiğin cihaza yönlendirir.

İşletim sistemi veya sürücü cihaz seçimini desteklemiyorsa sistem varsayılanı kullanılmaya devam eder.

## MKV ve MOV hakkında

MKV/MOV birer kapsayıcıdır; içlerindeki video ve ses codec'leri değişebilir. Electron/Chromium birçok Matroska ve QuickTime dosyasını doğrudan açar, fakat AC-3/DTS veya desteklenmeyen başka bir codec sorun çıkarabilir.

Bu projede iki katman vardır:

1. Önce dosya doğrudan oynatılır.
2. Decode/format hatası oluşursa FFmpeg otomatik olarak yerel bir H.264/AAC MP4 hazırlar.

İstersen **Uyumlu MP4 Hazırla** düğmesiyle dönüşümü elle de başlatabilirsin. Video internete yüklenmez. Dönüştürülmüş geçici dosya işletim sisteminin temp klasöründe tutulur ve aynı kaynak dosya değişmedikçe tekrar kullanılabilir.

## Windows `.exe` oluşturma

```bash
npm run dist:win
```

Çıktılar `dist/` klasöründe oluşur:

- NSIS kurulum `.exe`si
- Taşınabilir `.exe`

Ya da `WINDOWS-EXE-OLUSTUR.bat` dosyasına çift tıkla.

## Test

```bash
npm test
```

Testler SRT zaman kodu ayrıştırma, çok satırlı altyazı ve aktif altyazı bulma davranışını denetler.

## Güvenlik yapısı

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- Renderer yalnızca preload içindeki sınırlı IPC işlevlerine erişebilir
- Renderer rastgele bir dosya yolunu FFmpeg'e gönderemez; yalnızca dosya seçiciden açılmış videolar dönüştürülebilir
- Haricî web sayfası açılmaz

## Dağıtım notu

`ffmpeg-static` paketindeki FFmpeg binary'sini başka kişilere dağıtmadan önce kullanılan FFmpeg derlemesinin lisans şartlarını kontrol et. Kişisel geliştirme ve prototip kullanımında bu genellikle sorun çıkarmaz; ticari dağıtımda lisans incelemesi gerekir.

## Sürükle-bırak

Video dosyasını veya `.srt` altyazıyı doğrudan oynatıcı alanına sürükleyip bırakabilirsin. Video ile altyazıyı aynı anda bırakırsan ikisi de otomatik yüklenir. Üstteki **Video Aç** ve **SRT Aç** düğmeleri alternatif olarak çalışmaya devam eder.
