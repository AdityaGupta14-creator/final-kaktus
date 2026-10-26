import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-20 px-6">
      <div className="max-w-3xl mx-auto bg-white p-8 md:p-12 rounded-3xl shadow-sm border border-gray-100">
        <Link href="/" className="text-blue-600 hover:underline mb-8 inline-block font-medium">&larr; Back to Home</Link>
        <h1 className="text-4xl font-bold mb-8 text-black">Privacy Policy</h1>
        
        <div className="prose prose-gray max-w-none text-gray-600">
          <p className="mb-4">Last updated: {new Date().toLocaleDateString()}</p>
          
          <h2 className="text-2xl font-bold text-black mt-8 mb-4">1. Information We Collect</h2>
          <p className="mb-4">We collect information you provide directly to us when you create an account, subscribe to a plan, or contact our support team. This includes your email address, name, and usage data within our IDE.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">2. How We Use Your Information</h2>
          <p className="mb-4">We use the information to provide, maintain, and improve our services, process transactions, send related information (including confirmations and invoices), and provide customer support.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">3. Data Security</h2>
          <p className="mb-4">We implement appropriate technical and organizational measures to protect your personal data against unauthorized or unlawful processing.</p>

          <h2 className="text-2xl font-bold text-black mt-8 mb-4">4. Contact Us</h2>
          <p className="mb-4">If you have any questions about this Privacy Policy, please contact us at <a href="mailto:dixitshubham68359@gmail.com" className="text-emerald-600 underline">dixitshubham68359@gmail.com</a>.</p>
        </div>
      </div>
    </div>
  );
}
