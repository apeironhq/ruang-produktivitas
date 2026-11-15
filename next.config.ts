import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Halaman yang baru dibuka disimpan di cache klien → kembali ke menu yang sama terasa instan.
    // Aksi simpan/ubah/hapus memanggil revalidatePath sehingga data tetap segar setelah perubahan.
    staleTimes: { dynamic: 60, static: 300 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/fonts/:path*",
        headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
