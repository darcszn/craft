import type { Metadata } from 'next';
import SignUpForm from './SignUpForm';

export const metadata: Metadata = {
    title: 'Create account – CRAFT',
    description: 'Sign up for CRAFT and start deploying DeFi apps on Stellar.',
};

export default function SignUpPage() {
    return (
        <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
                <p className="mt-1 text-sm text-gray-500">
                    Deploy DeFi apps on Stellar in minutes.
                </p>
            </div>
            <SignUpForm />
        </div>
    );
}
