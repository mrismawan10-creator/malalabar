"use client";

export function PaymentSuccess() {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center justify-center min-h-screen px-4">
      <div className="bg-white rounded-lg shadow p-8 text-center">
        {/* Success Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-4xl">✓</span>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Pembayaran Berhasil</h1>
        <p className="text-gray-600 mb-6">
          Terima kasih telah melakukan pemesanan. Pesanan Anda sedang diproses.
        </p>

        {/* Info Box */}
        <div className="bg-blue-50 p-4 rounded-lg mb-6 text-left">
          <p className="text-sm text-gray-600 mb-2">
            ℹ️ Pesanan akan segera sampai ke dapur. Staf kami akan memberitahu Anda ketika pesanan siap untuk diambil.
          </p>
        </div>

        {/* Instructions */}
        <div className="space-y-3 mb-8 text-left">
          <h3 className="font-semibold text-gray-900">Apa selanjutnya?</h3>
          <ol className="text-sm text-gray-600 space-y-2">
            <li className="flex gap-2">
              <span className="font-semibold text-blue-600">1.</span>
              <span>Pesanan Anda akan disiapkan di dapur</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-blue-600">2.</span>
              <span>Anda akan mendapat notifikasi ketika pesanan siap</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-blue-600">3.</span>
              <span>Ambil pesanan Anda di counter</span>
            </li>
          </ol>
        </div>

        {/* Close Button */}
        <button
          onClick={() => {
            // Close the app or return to home
            if (window.history.length > 1) {
              window.history.back();
            } else {
              window.location.href = "/";
            }
          }}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
        >
          Selesai
        </button>

        {/* Footer */}
        <p className="text-xs text-gray-500 mt-6">
          Jika Anda memiliki pertanyaan, hubungi staf kami
        </p>
      </div>
    </div>
  );
}
