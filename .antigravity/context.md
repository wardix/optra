# 📡 Antigravity Onboarding & Context Briefing

Dokumen ini ditujukan sebagai **jembatan konteks (Context Bridge)** untuk Engineer baru dan AI Coding Assistant (**Antigravity**) mereka saat melanjutkan pengembangan proyek **OPTRA (Protelindo ONT Monitor) v2.0**.

---

## 🧭 Panduan Singkat untuk Antigravity Agent Baru

> [!IMPORTANT]
> **Pesan untuk Antigravity Agent:**
> Saat pertama kali memulai sesi di workspace ini, harap baca berkas ini dan dokumen terkait di folder `.antigravity/` untuk memahami arsitektur, keputusan desain, dan log historis proyek ini. Ini akan menghemat token konteks dan memberikan Anda basis pengetahuan instan tanpa perlu berspekulasi.

### Dokumen Referensi Tersedia:
1. **[walkthrough.md](./walkthrough.md)**: Log historis langkah-demi-langkah dari seluruh modifikasi, refactoring, decoupling, dan optimasi yang telah diselesaikan.
2. **[database_design.md](./database_design.md)**: Rancangan skema database relasional PostgreSQL (tabel telemetri log, status aktif saat ini, dan token sesi).
3. **[postgresql_migration_fullstack.md](./postgresql_migration_fullstack.md)**: Panduan migrasi lengkap untuk backend Hono, daemon pemantau, dan frontend React 19.
4. **[scaling_strategy.md](./scaling_strategy.md)**: Rencana strategis untuk memperluas jangkauan platform memantau puluhan ribu ONT secara stabil dan efisien.

---

## 🛠️ Ringkasan Status Proyek Terakhir

Proyek OPTRA v2.0 telah didesain ulang agar **Decoupled (Terpisah)** dan **Stateless** menggunakan database PostgreSQL terpusat:
1. **Sweeper Daemon (`src/sweeper.ts`)**: Berfungsi sebagai daemon latar belakang mandiri yang memantau telemetri OLT pelanggan secara berkala melalui loop sekuensial dengan *delay* aman. Dilengkapi sistem *bypass* dan *progressive offline backoff* untuk menghemat API rate-limit.
2. **Web Portal Server (`src/server.ts`)**: Menyajikan API REST (`/api/stats`, `/api/weak-signals`, `/api/outages`, `/api/history/:homepassId`) dan endpoint pemicu pengecekan live (`POST /api/check`). Hono server ini juga menyajikan berkas statis frontend React (`frontend/dist/`) pada lingkungan produksi.
3. **Frontend Dashboard (`frontend/src/App.tsx`)**: Dashboard modern *Dark-NOC* berbasis React 19, Vite, dan DaisyUI v5. Memiliki 5 tab filter data telemetri, pencarian instan, riwayat audit, dan tombol cek live interaktif.
4. **Database & Centralized Auth (`src/database.ts` & `src/protelindo.ts`)**: Menghapus `session.json` lokal. Token sesi Protelindo (`access_token` & `refresh_token`) disimpan statelessly di tabel `ont_auth_session` dalam PostgreSQL untuk dipakai bersama oleh Daemon dan Web Server secara aman.

---

## ⚙️ Standardisasi Format & Kualitas Kode

Proyek ini telah dikonfigurasi dengan alat pemeliharaan kode otomatis:
* **Biome (`biome.json`)**: Digunakan sebagai pemformat kode (*code formatter*) super cepat dengan aturan spasi indentasi 2, tanda petik tunggal (`'`), dan penggunaan titik koma seperlunya (*semicolons asNeeded*).
* **Husky & lint-staged (`.husky/` & `package.json`)**: Mengotomatiskan pemformatan kode sebelum commit. Setiap kali Anda menjalankan `git commit`, berkas `.ts`/`.tsx` yang di-stage (`git add`) akan otomatis dirapikan oleh Biome di latar belakang.

---

## 🚦 Cara Melanjutkan Pengembangan (Next Action Steps)

Ketika Antigravity agent baru memulai sesi, Anda dapat menginstruksikannya untuk:
1. **Verifikasi Database & Dependencies**:
   ```bash
   bun install
   cd frontend && bun install
   ```
2. **Jalankan Pemformat Kode**:
   ```bash
   bun run format
   ```
3. **Jalankan Mode Pengembangan**:
   * Jalankan Web Server: `bun run dev:server`
   * Jalankan Sweeper Daemon: `bun run dev:sweeper`
   * Jalankan Frontend Dev: `cd frontend && bun run dev`
4. **Ambil Rencana Pengembangan Selanjutnya**:
   Mintalah agen Antigravity membaca bagian akhir **[scaling_strategy.md](./scaling_strategy.md)** untuk mulai menerapkan *Multi-threaded API dispatchers*, *database partitioning*, atau *real-time push notifications via WebSockets*.
