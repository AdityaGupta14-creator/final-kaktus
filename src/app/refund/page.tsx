import Link from 'next/link';

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-20 px-6">
      <div className="max-w-3xl mx-auto bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-gray-100">
        <Link href="/" className="text-blue-600 hover:underline mb-8 inline-block font-medium">&larr; Back to Home</Link>
        <h1 className="text-4xl font-bold mb-8 text-black">Refund and Cancellation Policy</h1>
        
        <div className="prose prose-gray max-w-none text-gray-600">
          <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-2xl font-bold text-black mt-8 mb-4">1. Cancellations</h2>
          <p className="mb-4">You may cancel your subscription at any time. Your cancellation will take effect at the end of the current paid term. You will retain access to the Pro features until your billing cycle ends.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">2. Refunds</h2>
          <p className="mb-4">We offer a 7-day money-back guarantee for all new subscriptions. If you are not satisfied with the product, you can request a full refund within 7 days of your initial purchase by contacting our support team.</p>
          <p className="mb-4">Refunds are processed to the original payment method and may take 5-7 business days to reflect in your account.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">3. Exceptions</h2>
          <p className="mb-4">Refunds will not be provided for partial months of service or for accounts that have violated our Terms and Conditions.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">4. Contact for Refunds</h2>
          <p className="mb-4">To request a refund or cancellation, please email us at admin@kaktus.com with your account details and order ID.</p>
        </div>
      </div>
    </div>
  );
}
