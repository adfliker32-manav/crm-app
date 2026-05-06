import React from 'react';
import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
    <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-teal-500 rounded-full inline-block"></span>
            {title}
        </h2>
        <div className="text-slate-600 leading-relaxed space-y-2 pl-4">{children}</div>
    </div>
);

const TermsAndConditions = () => {
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white py-12 px-4">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-file-contract text-white"></i>
                        </div>
                        <span className="text-teal-400 font-semibold text-sm uppercase tracking-widest">Legal</span>
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Terms & Conditions</h1>
                    <p className="text-slate-400 text-sm">Last updated: May 2026</p>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-3xl mx-auto px-4 py-10">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <p className="text-slate-600 leading-relaxed mb-8">
                        Please read these Terms and Conditions carefully before using <strong>Adfliker CRM</strong> ("the
                        Service") operated by Adfliker. By accessing or using the Service you agree to be bound by these terms.
                    </p>

                    <Section title="1. Acceptance of Terms">
                        <p>
                            By creating an account and accessing the Service, you confirm that you are at least 18 years of
                            age, have read and understood these Terms, and agree to be bound by them. If you are using the
                            Service on behalf of a company or organisation, you represent that you have authority to bind
                            that entity to these Terms.
                        </p>
                    </Section>

                    <Section title="2. Use of the Service">
                        <p>You agree to use the Service only for lawful purposes and in accordance with these Terms. You must not:</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li>Use the Service to send spam, unsolicited messages, or harass any person.</li>
                            <li>Attempt to gain unauthorised access to any part of the Service or its related systems.</li>
                            <li>Upload or transmit any malicious code, viruses, or disruptive data.</li>
                            <li>Resell or sublicense the Service without written permission from Adfliker.</li>
                            <li>Violate any applicable laws or regulations, including WhatsApp and Meta platform policies.</li>
                        </ul>
                    </Section>

                    <Section title="3. Account Responsibility">
                        <p>
                            You are responsible for maintaining the confidentiality of your account credentials. All
                            activities that occur under your account are your responsibility. You must notify us immediately
                            of any unauthorised use of your account at <strong>adfliker32@gmail.com</strong>.
                        </p>
                    </Section>

                    <Section title="4. WhatsApp & Meta Integration">
                        <p>
                            The Service integrates with Meta's WhatsApp Business API. By using these features you also agree
                            to Meta's Terms of Service and WhatsApp Business Policy. Adfliker is not responsible for
                            violations of Meta's policies by users. Misuse of broadcast or automation features that results
                            in account suspension by Meta is solely the user's responsibility.
                        </p>
                    </Section>

                    <Section title="5. Data & Privacy">
                        <p>
                            Your use of the Service is also governed by our{' '}
                            <Link to="/privacy" className="text-teal-600 font-semibold hover:underline">Privacy Policy</Link>,
                            which is incorporated into these Terms by reference. By using the Service you consent to the
                            collection and use of your data as described therein.
                        </p>
                    </Section>

                    <Section title="6. Intellectual Property">
                        <p>
                            All content, features, and functionality of the Service — including but not limited to software,
                            text, graphics, and logos — are the exclusive property of Adfliker and are protected by
                            applicable intellectual property laws. You may not copy, modify, or distribute any part of the
                            Service without prior written consent.
                        </p>
                    </Section>

                    <Section title="7. Service Availability">
                        <p>
                            We strive to maintain 99% uptime but do not guarantee uninterrupted access. The Service may be
                            temporarily unavailable due to maintenance, updates, or factors outside our control. Adfliker
                            shall not be liable for any loss arising from service interruptions.
                        </p>
                    </Section>

                    <Section title="8. Termination">
                        <p>
                            We reserve the right to suspend or terminate your account at our discretion if you breach these
                            Terms, without prior notice. Upon termination, your right to use the Service ceases immediately.
                            You may request account deletion by contacting support.
                        </p>
                    </Section>

                    <Section title="9. Limitation of Liability">
                        <p>
                            To the fullest extent permitted by law, Adfliker shall not be liable for any indirect,
                            incidental, special, or consequential damages arising from your use of the Service, including
                            but not limited to loss of data, revenue, or business opportunity.
                        </p>
                    </Section>

                    <Section title="10. Changes to These Terms">
                        <p>
                            We may update these Terms from time to time. We will notify you of significant changes via
                            in-app notification or email. Continued use of the Service after changes constitutes acceptance
                            of the revised Terms.
                        </p>
                    </Section>

                    <Section title="11. Contact">
                        <p>
                            For any questions about these Terms, please contact us at:{' '}
                            <strong>adfliker32@gmail.com</strong>
                        </p>
                    </Section>
                </div>

                <div className="mt-6 text-center">
                    <Link to="/privacy" className="text-teal-600 hover:underline text-sm font-medium">
                        View Privacy Policy →
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default TermsAndConditions;
