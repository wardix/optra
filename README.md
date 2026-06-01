# 📡 OPTRA: Protelindo ONT Telemetry & Monitoring Portal (v2.0)

**OPTRA** (Operational Protelindo Telemetry & Resource Analyzer) adalah platform monitoring, audit log, dan dashboard operasional real-time *production-grade* yang dirancang khusus untuk memantau status OLT dan ONT pada jaringan FTTx Protelindo secara efisien dan tangguh. 

Dibangun di atas runtime **Bun**, framework **Hono**, **React 19**, **Tailwind CSS v4**, dan **PostgreSQL**, OPTRA menyapu ribuan pelanggan secara sekuensial melalui API Gateway, mengimplementasikan *three-tier telemetry bypass* untuk menghemat bandwidth/rate limit API, dan menyediakan portal komando NOC dengan visualisasi futuristik berbasis DaisyUI v5.

---

## 🚀 Fitur Utama

### 1. Daemon Pemantau Cerdas (OPTRA Sweeper Daemon)
* **Pembersihan Sekuensial**: Menyapu daftar pelanggan dari NIS Gateway halaman demi halaman dan mengecek status live ONT secara sekuensial dengan jeda waktu (*query delay*) yang dapat disesuaikan untuk mencegah *rate limit* atau pemblokiran IP.
* **Tiga Lapisan Optimasi Sweep (Three-Tier Sweep Bypass & Backoff Engine)**:
  1. **Bypass Pemadaman Listrik (Dying-Gasp Cooldown)**: Mendeteksi jika ONT mati karena kegagalan daya (*dying-gasp*). Pemantau akan membypass (tidak melakukan hit API) pelanggan tersebut selama **8 jam** (atau dikonfigurasi via `.env`) untuk menghemat *resource*.
  2. **Bypass Sinyal Prima (Good-Signal Cooldown)**: Pelanggan dengan daya terima optik sangat sehat (Rx lebih baik dari `-20 dBm`) akan dibypass selama **6 jam** karena probabilitas mengalami gangguan mendadak sangat rendah.
  3. **Progressive Offline Backoff**: Throttling adaptif untuk pelanggan yang telah offline lama (misal: suspensi/isolir atau kabel putus fisik). Siklus pemantauan diperlambat secara bertahap berdasarkan durasi downtime:
     * Offline 1–6 jam: Cukup dicek setiap **60 menit**.
     * Offline 6–24 jam: Cukup dicek setiap **4 jam** (240 menit).
     * Offline > 24 jam: Cukup dicek setiap **12 jam** (720 menit).

### 2. Portal Komando NOC (Incident Command Center)
* Dashboard *single-page application* dengan tema *Dark-NOC* premium menggunakan palette warna terkurasi (Slate-950/Cyan/Indigo/Emerald/Rose).
* **5 Tab Data Kasus Terfilter**:
  1. **🔴 Offline > 40 Hari**: Daftar khusus pelanggan dengan downtime kronis di atas 40 hari, diurutkan dari durasi downtime terlama (paling kritis) ke terbaru.
  2. **⚠️ Sinyal Lemah**: Menampilkan seluruh ONT online dengan daya terima optik lemah (Rx <= -24 dBm) untuk pemeliharaan preventif.
  3. **❌ Mati karena LOS**: Menampilkan ONT yang mati akibat kehilangan sinyal (*Loss of Signal*), diurutkan berdasarkan awal downtime terlama.
  4. **❓ Penyebab Tidak Spesifik (--)**: Menampilkan ONT offline dengan alasan tidak spesifik dari OLT.
  5. **⚠️ Status Tidak Diketahui**: Mengelompokkan ONT dengan kesalahan telemetry (*error*) atau status run-state `unknown`.
* **Pencarian Cepat**: Pencarian dinamis berbasis ID Pelanggan, Nama, Circuit ID, atau Homepass ID di seluruh list.

### 3. Pengecekan OLT Live Interaktif (Interactive Manual Check)
* Staf NOC dapat memicu pengecekan live ONT secara real-time langsung dari panel kanan detail pelanggan. Pengecekan ini langsung menembak API Protelindo, memperbarui database secara instan, dan memperbarui visualisasi riwayat log tanpa menunggu jadwal putaran daemon.

### 4. Stateless Shared Session (Database Auth Cache)
* Menghilangkan dependensi file sesi lokal (`session.json`). Sesi autentikasi disimpan terpusat di tabel database PostgreSQL `ont_auth_session`.
* Baik proses Web Server Hono maupun Daemon Pemantau menggunakan sesi stateless yang sama secara aman tanpa tabrakan.
* Menggunakan alur **OAuth2 Access & Refresh Token** otomatis dengan mekanisme *fallback credentials login* otomatis yang senyap (*silent login*) jika *refresh token* kedaluwarsa.

---

## 🛠️ Tech Stack & Arsitektur

* **Runtime Engine**: [Bun v1.1+](https://bun.sh) (Eksekusi super cepat, loader TypeScript bawaan, driver SQL berkinerja tinggi).
* **Backend Web Server**: [Hono Framework v4+](https://hono.dev) (Ultralight, cepat, native Bun API).
* **Frontend Core**: **React 19**, **Vite 8**, **TypeScript 6**.
* **Styling**: **Tailwind CSS v4** (CSS-first configuration) + **DaisyUI v5** (Theme: Dark/NOC Theme).
* **Database**: **PostgreSQL 15+** (Penyimpanan relasional berkinerja tinggi untuk log historis, status terkini, dan token sesi).

---

## 📁 Struktur Direktori Proyek

```
protelindo-ont-monitor/
├── .antigravitycli/        # Konfigurasi workspace agen
├── src/                    # Backend & Pemantau Daemon (Bun + TypeScript)
│   ├── database.ts         # Wrapper PostgreSQL Client (Bun SQL bindings)
│   ├── sweeper.ts          # Entrypoint Daemon Pemantau (OPTRA Sweeper)
│   ├── nis.ts              # Client API NIS Gateway (Data Pelanggan)
│   ├── protelindo.ts       # Client API Protelindo (Autentikasi & Query ONT)
│   ├── server.ts           # REST API & Portal Web Hono
│   └── types.ts            # Type definitions & Interfaces TypeScript
├── frontend/               # Frontend React Application
│   ├── dist/               # Bundle build produksi frontend (React SPA)
│   ├── public/             # Aset statis frontend
│   ├── src/                # Kode sumber React 19 + Tailwind v4
│   │   ├── App.tsx         # Dashboard NOC Utama
│   │   ├── index.css       # Tailwind CSS v4 directives
│   │   └── main.tsx        # React mounting entrypoint
│   ├── package.json        # Dependensi frontend & scripts
│   └── vite.config.ts      # Konfigurasi bundling Vite
├── .env.example            # Template variabel lingkungan operasional
├── package.json            # Dependensi backend root
└── bun.lock                # Lockfile dependensi Bun
```

---

## 📊 Skema Database PostgreSQL

OPTRA secara otomatis membuat tabel dan indeks yang diperlukan pada saat *startup* server Hono atau Daemon Pemantau. Berikut rancangan skema tabelnya:

```mermaid
erDiagram
    ont_auth_session {
        int id PK
        text access_token
        text refresh_token
        int expires_in
        bigint created_at
    }
    ont_current_status {
        int subscriber_id PK
        varchar circuit_id
        varchar homepass_id
        varchar run_state
        double_precision rx_optical_power
        varchar last_down_cause
        bigint last_down_time
        text raw_response
        bigint updated_at
    }
    ont_telemetry_logs {
        int id PK "SERIAL"
        int subscriber_id
        varchar circuit_id
        varchar homepass_id
        varchar run_state
        varchar last_down_cause
        bigint last_down_time
        text raw_response
        bigint checked_at
    }
```

### 1. Tabel Sesi Autentikasi (`ont_auth_session`)
Menyimpan token autentikasi API Protelindo yang digunakan bersama oleh Daemon dan Hono REST API.
```sql
CREATE TABLE IF NOT EXISTS ont_auth_session (
  id INT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_in INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
```

### 2. Tabel Status Terkini (`ont_current_status`)
Menyimpan rangkuman status aktif terbaru dari masing-masing pelanggan (1 baris per pelanggan).
```sql
CREATE TABLE IF NOT EXISTS ont_current_status (
  subscriber_id INTEGER PRIMARY KEY,
  circuit_id VARCHAR(255) NOT NULL,
  homepass_id VARCHAR(255) NOT NULL,
  run_state VARCHAR(50) NOT NULL,
  rx_optical_power DOUBLE PRECISION,
  last_down_cause VARCHAR(100),
  last_down_time BIGINT,
  raw_response TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
```
**Indeks Kinerja:**
* `idx_current_signal`: Digunakan untuk memfilter ONT lemah secara cepat (`run_state = 'online' AND rx_optical_power IS NOT NULL`).
* `idx_current_down_cause`: Mempercepat penyaringan berdasarkan tipe kegagalan (`run_state = 'offline' AND last_down_cause IS NOT NULL`).
* `idx_current_downtime`: Mengurutkan downtime terlama untuk prioritas penanganan NOC (`run_state = 'offline' AND last_down_time IS NOT NULL`).

### 3. Tabel Log Historis (`ont_telemetry_logs`)
Menyimpan rekam jejak audit log seluruh sapuan pemantauan historis (*time-series*).
```sql
CREATE TABLE IF NOT EXISTS ont_telemetry_logs (
  id SERIAL PRIMARY KEY,
  subscriber_id INTEGER NOT NULL,
  circuit_id VARCHAR(255) NOT NULL,
  homepass_id VARCHAR(255) NOT NULL,
  run_state VARCHAR(50) NOT NULL,
  last_down_cause VARCHAR(100),
  last_down_time BIGINT,
  raw_response TEXT NOT NULL,
  checked_at BIGINT NOT NULL
);
```
**Indeks Kinerja:**
* `idx_homepass_check`: Mengambil riwayat pemantauan sub-pelanggan secara instan (`homepass_id, checked_at DESC`).

---

## ⚙️ Variabel Lingkungan (.env)

Buat file `.env` di direktori root berdasarkan template `.env.example` berikut:

| Variabel Lingkungan | Deskripsi | Default / Rekomendasi |
| :--- | :--- | :--- |
| **PROTELINDO_AUTH_API_URL** | Endpoint API Oauth token Protelindo | `https://api-endpoint.example.com/oauth/token` |
| **PROTELINDO_ONT_STATUS_API_URL** | Endpoint API detail status ONT Protelindo | `https://api-endpoint.example.com/ont/status/detail` |
| **PROTELINDO_API_USERNAME** | Username akun API Protelindo | `username_mitra` |
| **PROTELINDO_API_PASSWORD** | Password akun API Protelindo | `password_mitra` |
| **PARTNER_SOURCE** | Identitas partner | `NUSANET` |
| **NIS_HOMEPASS_API_URL** | Endpoint API pengambilan data pelanggan | `https://nis-gateway.example.com/subscriber/fttx-homepasses` |
| **NIS_GATEWAY_TOKEN** | Token bearer akses NIS Gateway | `token_bear_akses_nis` |
| **PROTELINDO_OPERATOR_ID** | Kode operator jaringan | `22` |
| **DATABASE_URL** | Connection string PostgreSQL | `postgres://postgres:postgres@localhost:5432/optra_db` |
| **PORT** | Port untuk Web Portal Hono | `3000` |
| **ONT_QUERY_DELAY_MS** | Jeda sekuensial antar query ONT | `1000` (1 detik) |
| **MONITOR_LOOP_INTERVAL_MS** | Cooldown tidur daemon antar sweep siklus | `300000` (5 menit) |
| **MONITOR_MAX_PAGES** | Batas maksimal halaman NIS (0 = sapu semua) | `0` |
| **MONITOR_CONCURRENCY** | Jumlah pekerja (worker) paralel pemantauan ONT | `5` (5 worker paralel) |
| **DYING_GASP_SKIP_HOURS** | Cooldown bypass pengecekan mati listrik | `8` (8 jam) |
| **GOOD_SIGNAL_SKIP_HOURS** | Cooldown bypass pengecekan sinyal prima | `6` (6 jam) |
| **GOOD_SIGNAL_THRESHOLD** | Batas daya minimal klasifikasi sinyal prima | `-20` (-20 dBm) |
| **OFFLINE_BACKOFF_1_TO_6_HOURS_SKIP_MINUTES** | Jeda pemantauan jika mati 1 s.d 6 jam | `60` (1 jam) |
| **OFFLINE_BACKOFF_6_TO_24_HOURS_SKIP_MINUTES** | Jeda pemantauan jika mati 6 s.d 24 jam | `240` (4 jam) |
| **OFFLINE_BACKOFF_ABOVE_24_HOURS_SKIP_MINUTES**| Jeda pemantauan jika mati > 24 jam | `720` (12 jam) |

---

## 🏁 Memulai Penginstalan (Getting Started)

### 📋 Prasyarat
1. **Bun Runtime** terinstal pada server:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
2. Database **PostgreSQL 15+** aktif dan dapat dijangkau.

---

### 📦 Langkah Instalasi & Menjalankan Aplikasi

#### 1. Kloning Repositori
```bash
git clone https://github.com/username/protelindo-ont-monitor.git
cd protelindo-ont-monitor
```

#### 2. Instalasi Dependensi
Instal seluruh modul untuk backend daemon pada folder root, kemudian instal modul frontend React:
```bash
# Instal dependensi backend root
bun install

# Instal dependensi frontend React
cd frontend
bun install
cd ..
```

#### 3. Konfigurasi Lingkungan
Salin berkas `.env.example` ke `.env` dan isi seluruh kredensial API dan database Anda:
```bash
cp .env.example .env
nano .env
```

#### 4. Menjalankan dalam Mode Pengembangan (Development)
Anda dapat menggunakan *helper scripts* yang telah didefinisikan di `package.json` root, atau menjalankan file TypeScript secara langsung menggunakan Bun di terminal terpisah secara paralel:

* **Terminal 1: Jalankan Web Server Portal Hono**
  ```bash
  # Menggunakan script
  bun run dev:server
  
  # Atau jalankan file langsung
  bun run src/server.ts
  ```
  *Server akan berjalan di http://localhost:3000.*

* **Terminal 2: Jalankan Daemon Sweeper (Background Monitor)**
  ```bash
  # Menggunakan script
  bun run dev:sweeper
  
  # Atau jalankan file langsung
  bun run src/sweeper.ts
  ```
  *Daemon akan mulai memantau dan mencatat telemetry log secara periodik.*

* **Terminal 3: Jalankan Frontend Dev Server**
  ```bash
  cd frontend
  bun run dev
  ```
  *HMR Vite akan aktif di http://localhost:5173 (secara otomatis proxy request API ke port 3000).*

* **Format Kode Sumber (Biome)**
  ```bash
  bun run format
  ```
  *Memformat otomatis seluruh berkas TypeScript dan React (TSX) sesuai aturan biome.json.*

---

#### 5. Kompilasi & Jalankan untuk Produksi (Production Ready)
Pada lingkungan produksi, Anda hanya perlu menjalankan satu proses web portal karena Hono secara otomatis menyajikan file statis React yang sudah dikompilasi.

```bash
# 1. Kompilasi aplikasi frontend React
cd frontend
bun run build
cd ..

# 2. Jalankan portal utama (menyajikan dashboard statis dan REST API secara simultan)
bun run dev:server # atau: bun run src/server.ts

# 3. Jalankan daemon pemantau latar belakang secara terpisah (misal menggunakan PM2 atau systemd)
bun run dev:sweeper # atau: bun run src/sweeper.ts
```

---

## 🔄 Alur Kerja Operasional (Operational Workflows)

### A. Progressive Backoff Alur Pengecekan
Untuk mengoptimalkan efisiensi, Daemon mengevaluasi status terakhir pelanggan sebelum memanggil API Protelindo:

```mermaid
flowchart TD
    Start([Pelanggan Baru dalam Sweep]) --> CheckDyingGasp{Mati akibat Dying-Gasp\n< 8 Jam lalu?}
    CheckDyingGasp -- Ya --> SkipCheck[Bypass API & Gunakan Status Cache]
    CheckDyingGasp -- Tidak --> CheckGoodSignal{Sinyal Prima > -20 dBm\n< 6 Jam lalu?}
    CheckGoodSignal -- Ya --> SkipCheck
    CheckGoodSignal -- Tidak --> EvaluateDowntime{Berapa lama\nONT sudah Offline?}
    
    EvaluateDowntime -- 1 s.d 6 Jam --> CheckBackoff1{Sudah 60 menit\nsejak cek terakhir?}
    CheckBackoff1 -- Belum --> SkipCheck
    CheckBackoff1 -- Sudah --> HitAPI[Hubungi API Protelindo & Simpan Log]
    
    EvaluateDowntime -- 6 s.d 24 Jam --> CheckBackoff2{Sudah 4 jam\nsejak cek terakhir?}
    CheckBackoff2 -- Belum --> SkipCheck
    CheckBackoff2 -- Sudah --> HitAPI
    
    EvaluateDowntime -- Di atas 24 Jam --> CheckBackoff3{Sudah 12 jam\nsejak cek terakhir?}
    CheckBackoff3 -- Belum --> SkipCheck
    CheckBackoff3 -- Sudah --> HitAPI
    
    EvaluateDowntime -- ONT Online / Baru --> HitAPI
```

### B. Mekanisme Stateless Auth & Silent Token Recovery
Autentikasi platform didesain stateless untuk mencegah bentrokan proses Hono dan Daemon:

```
[Proses Hono / Daemon] 
       │
       ▼
1. Panggil ProtelindoAuthManager.getValidAccessToken()
       │
       ▼
2. Ambil token sesi aktif terakhir dari tabel `ont_auth_session`
       │
       ├─── [Token Valid & Belum Kedaluwarsa] ───> Kembalikan access_token (Instan)
       │
       └─── [Token Kedaluwarsa atau Mendekati Expired (Buffer 5 Menit)]
               │
               ▼
       3. Panggil refresh() menggunakan `refresh_token` dari database
               │
               ├─── [Refresh Berhasil] ───> Simpan sesi baru ke PostgreSQL ──> Kembalikan token
               │
               └─── [Refresh Gagal / Expired]
                       │
                       ▼
               4. Lakukan full login() menggunakan username & password
                       │
                       ▼
               5. Simpan sesi baru ke PostgreSQL ──> Kembalikan token
```

---

## 🔄 Pemformatan Otomatis Saat Commit (Git Pre-commit Hook)

OPTRA telah dilengkapi dengan pengelola Git Hooks **Husky** dan **lint-staged**. Setiap kali Anda melakukan `git commit`, berkas TypeScript (`.ts`, `.tsx`) yang telah di-stage (`git add`) akan otomatis diformat oleh Biome sebelum commit diselesaikan.

Jika Anda perlu menonaktifkan pemformatan otomatis saat commit untuk sementara waktu (misalnya untuk commit mendesak), Anda dapat menambahkan opsi `--no-verify` pada perintah commit:
```bash
git commit -m "commit pesan" --no-verify
```

---

## ❓ Pemecahan Masalah (Troubleshooting & FAQ)

#### 1. Mengapa log pemantau daemon memunculkan pesan `Protelindo Authentication variables are missing`?
* **Solusi**: Pastikan Anda telah membuat berkas `.env` di folder root utama (bukan di dalam folder `frontend`) dan mengisi kredensial API secara lengkap. Pastikan tidak ada spasi di sekitar tanda sama dengan (`=`).

#### 2. Error: `could not connect to server: Connection refused`
* **Solusi**: 
  1. Pastikan server PostgreSQL Anda berjalan dengan lancar.
  2. Periksa parameter koneksi pada `DATABASE_URL` di berkas `.env` Anda.
  3. Gunakan perintah `pg_isready` untuk memastikan kesiapan database.

#### 3. Bagaimana cara membatasi pemindaian pelanggan untuk tujuan debugging?
* **Solusi**: Untuk mencegah pemindaian penuh terhadap puluhan ribu pelanggan selama fase uji coba, ubah variabel `MONITOR_MAX_PAGES=5` pada berkas `.env`. Hal ini akan membatasi daemon hanya menyapu 5 halaman NIS (maksimal 500 pelanggan) per siklus.

---
*OPTRA v2.0 dibuat dengan penuh dedikasi untuk keandalan infrastruktur NOC Protelindo.*
