# 📋 Rencana Kerja: PostgreSQL Migration & Full-stack Dashboard (Hono + React + DaisyUI)

Rencana ini merinci langkah-langkah memigrasi database SQLite ke **PostgreSQL (menggunakan Bun SQL Raw)** serta membangun aplikasi **Full-stack** lengkap dengan Backend API menggunakan **Hono** dan Frontend modern menggunakan **React, TailwindCSS, dan DaisyUI**.

---

## 🎯 Target Akhir (Goal)
Memindahkan sistem penyimpanan ke PostgreSQL, memisahkan daemon monitoring agar tetap berjalan di latar belakang (background), serta menyediakan dashboard berbasis web yang elegan dan pixel-perfect untuk pemantauan status ONT secara real-time.

---

## 🛠️ Langkah-Langkah (Tasks)

- [ ] **Langkah 1: Pembuatan Struktur Folder & Instalasi Dependensi**
  - Menginstal `hono` untuk backend web server.
  - Membuat folder `frontend/` menggunakan Vite React + TypeScript template.
  - Menginstal `tailwindcss`, `postcss`, `autoprefixer`, dan `daisyui` di folder `frontend/`.
  - *Verifikasi*: Jalankan `bun pm ls` untuk memastikan Hono terinstal, dan pastikan folder `frontend` terbentuk.

- [ ] **Langkah 2: Migrasi Database ke PostgreSQL (`src/database.ts`)**
  - Mengubah impor dari `bun:sqlite` ke `SQL` dari `bun` (menggunakan Bun.sql native client).
  - Menyesuaikan query inisialisasi tabel agar kompatibel dengan PostgreSQL (`SERIAL PRIMARY KEY`, `BIGINT`, `DOUBLE PRECISION`).
  - Mengubah sintaks raw query SQLite lama menjadi tagged template literals Bun SQL yang aman dan efisien (contoh: `` await sql`SELECT * FROM ...` ``).
  - *Verifikasi*: Pastikan file `src/database.ts` terkompilasi tanpa error TypeScript.

- [ ] **Langkah 3: Pembaruan Daemon Monitor (`index.ts`)**
  - Menyesuaikan loop `index.ts` agar menggunakan database PostgreSQL baru.
  - Membaca `DATABASE_URL` dari `.env`.
  - Menyediakan penanganan koneksi asynchronous yang aman menggunakan Bun SQL.
  - *Verifikasi*: Jalankan check sintaks `bun index.ts` untuk memastikan tidak ada error parser.

- [ ] **Langkah 4: Pembuatan API Server dengan Hono (`server.ts`)**
  - Membuat file `server.ts` sebagai entrypoint backend server Hono.
  - Membuat rute API berikut:
    - `GET /api/stats`: Mengembalikan statistik jaringan (total, online, offline, error, rata-rata sinyal, dying-gasp).
    - `GET /api/outages`: Mengembalikan daftar ONT yang offline (diurutkan berdasarkan durasi mati terlama).
    - `GET /api/weak-signals`: Mengembalikan 10 ONT dengan sinyal optik terlemah (`rx_optical_power`).
    - `GET /api/subscribers`: Daftar semua pelanggan dengan filter pencarian dan status.
    - `GET /api/history/:homepassId`: Riwayat log telemetri untuk homepass tertentu.
    - `POST /api/trigger`: Memicu pemindaian ulang jaringan secara asinkron di background.
  - Melayani static files dari folder `frontend/dist`.
  - *Verifikasi*: Server Hono berjalan di port `3000` dan rute API mengembalikan format JSON yang valid.

- [ ] **Langkah 5: Desain Frontend React & DaisyUI (`frontend/`)**
  - Membangun antarmuka dashboard premium yang modern dengan tema gelap (dark mode default) menggunakan DaisyUI.
  - Menambahkan komponen-komponen visual utama:
    - **Header**: Status koneksi, tombol "Refresh Data", dan tombol manual "Scan ONT Sekarang" (memicu API `/api/trigger`).
    - **Stats Cards**: Kartu metrik dengan animasi micro-interaction (Total ONTs, Online, Outages, Weak Signals, Power Outages).
    - **Outage Table**: Tabel interaktif gangguan terlama dengan durasi mati real-time (*relative time*).
    - **Weak Signals List**: Visualisasi bar kekuatan sinyal (hijau/kuning/merah).
    - **History Analyzer**: Modal atau panel untuk melihat riwayat grafik/tabel dari homepass tertentu yang diklik.
  - *Verifikasi*: Build frontend dengan `bun run build` di dalam folder `frontend` menghasilkan static assets di `frontend/dist`.

- [ ] **Langkah 6: Integrasi Penuh & Uji Coba**
  - Menjalankan Hono server yang melayani frontend terkompilasi secara simultan.
  - *Verifikasi*: Buka `http://localhost:3000` di browser dan pastikan data dinamis terisi sempurna serta seluruh tombol interaksi berfungsi normal.

---

## 📈 Done When
1. Database backend beralih sepenuhnya dari SQLite ke PostgreSQL menggunakan Bun SQL raw queries tanpa ORM.
2. Daemon pemantau tetap berjalan di background secara mulus membaca dari PostgreSQL.
3. Server backend Hono berhasil menyediakan REST API untuk melayani dashboard.
4. Dashboard frontend React + DaisyUI berhasil merender statistik jaringan, visualisasi redaman sinyal, tabel insiden terlama, dan fitur pencarian serta riwayat secara pixel-perfect.

---

## 💡 Catatan & Ambang Batas Konfigurasi
* `DATABASE_URL` akan ditambahkan di `.env` (contoh: `postgres://username:password@localhost:5432/protelindo_monitor`).
* Seluruh operasi query database menggunakan model tagged template literals Bun SQL untuk mencegah SQL Injection secara otomatis.
