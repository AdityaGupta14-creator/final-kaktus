import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-20 px-6">
      <div className="max-w-3xl mx-auto bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-gray-100">
        <Link href="/" className="text-blue-600 hover:underline mb-8 inline-block font-medium">&larr; Back to Home</Link>
        <h1 className="text-4xl font-bold mb-8 text-black">Terms and Conditions</h1>
        
        <div className="prose prose-gray max-w-none text-gray-600">
          <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-2xl font-bold text-black mt-8 mb-4">1. Acceptance of Terms</h2>
          <p className="mb-4">By accessing and using Kaktus (the "Service"), you agree to be bound by these Terms and Conditions.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">2. Use License</h2>
          <p className="mb-4">Permission is granted to temporarily use the materials and features on our platform for personal, non-commercial, or commercial hardware design purposes subject to your subscription plan.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">3. Subscriptions and Payments</h2>
          <p className="mb-4">Some features are billed on a subscription basis. You will be billed in advance on a recurring and periodic basis depending on your plan. Payments are securely processed by our payment partners (e.g., Cashfree, Razorpay).</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">4. Limitations</h2>
          <p className="mb-4">In no event shall Kaktus or its suppliers be liable for any damages arising out of the use or inability to use the platform.</p>
        </div>
      </div>
    </div>
  );
}
