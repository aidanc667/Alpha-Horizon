import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      <div className="relative flex flex-col items-center gap-6">
        <div className="flex items-center gap-3 mb-2">
          <img src="/logo.png" alt="Alpha Horizon" className="w-9 h-9 rounded-lg" />
          <span className="text-white font-semibold text-lg tracking-tight">Alpha Horizon</span>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
