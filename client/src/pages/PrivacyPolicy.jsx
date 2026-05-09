import React from 'react';
import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
    <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-500 rounded-full inline-block"></span>
            {title}
        </h2>
        <div className="text-slate-600 leading-relaxed space-y-2 pl-4">{children}</div>
    </div>
);

const PrivacyPolicy = () => {
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white py-12 px-4">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-shield-halved text-white"></i>
                        </div>
                        <span className="text-blue-400 font-semibold text-sm uppercase tracking-widest">Legal</span>
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
                    <p className="text-slate-400 text-sm">Last updated: May 2026</p>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-3xl mx-auto px-4 py-10">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                    <p className="text-slate-600 leading-relaxed mb-8">
                        This Privacy Policy describes how <strong>Adfliker CRM</strong> ("we", "us", or "our") collects,
                        uses, and protects your information when you use our Service. We are committed to protecting your
                        privacy and handling your data responsibly.
                    </p>

                    <Section title="1. Information We Collect">
                        <p>We collect the following types of information:</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li><strong>Account Information:</strong> Name, email address, company name, and password (hashed).</li>
                            <li><strong>CRM Data:</strong> Lead information, notes, follow-ups, and communication history you enter into the Service.</li>
                            <li><strong>WhatsApp Data:</strong> Messages sent and received via the WhatsApp Business API integration.</li>
                            <li><strong>Usage Data:</strong> Log data, IP addresses, browser type, pages visited, and feature usage.</li>
                            <li><strong>Integration Data:</strong> Credentials and configuration for third-party services (Meta, Google, email providers).</li>
                        </ul>
                    </Section>

                    <Section title="2. How We Use Your Information">
                        <p>We use the information we collect to:</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li>Provide, operate, and maintain the Service.</li>
                            <li>Enable WhatsApp messaging, CRM features, and automation workflows.</li>
                            <li>Send transactional emails and important service notifications.</li>
                            <li>Improve the Service through usage analytics.</li>
                            <li>Comply with legal obligations and enforce our Terms & Conditions.</li>
                        </ul>
                    </Section>

                    <Section title="3. Data Storage & Security">
                        <p>
                            Your data is stored on secure cloud servers. We implement industry-standard security measures
                            including encryption in transit (HTTPS/TLS), hashed passwords (bcrypt), and JWT-based
                            authentication. Access to your data is restricted to authorised personnel only.
                        </p>
                        <p>
                            However, no method of transmission over the internet is 100% secure. We cannot guarantee
                            absolute security but strive to use commercially acceptable means to protect your information.
                        </p>
                    </Section>

                    <Section title="4. Data Sharing">
                        <p>We do not sell or rent your personal data. We may share your data only in the following circumstances:</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li><strong>Service Providers:</strong> Third-party vendors who assist in operating the Service (e.g., cloud hosting, email delivery). They are bound by confidentiality agreements.</li>
                            <li><strong>Meta / WhatsApp:</strong> Messages and phone numbers are processed through Meta's WhatsApp Business API to deliver communications.</li>
                            <li><strong>Legal Requirements:</strong> If required by law, court order, or government authority.</li>
                            <li><strong>Business Transfer:</strong> In the event of a merger, acquisition, or sale of assets.</li>
                        </ul>
                    </Section>

                    <Section title="5. Cookies & Tracking">
                        <p>
                            We use cookies and similar technologies solely for authentication (keeping you logged in) and
                            session management. We do not use advertising cookies or third-party tracking for marketing
                            purposes within the Service.
                        </p>
                    </Section>

                    <Section title="6. Your Rights">
                        <p>You have the right to:</p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li>Access the personal data we hold about you.</li>
                            <li>Request correction of inaccurate data.</li>
                            <li>Request deletion of your account and associated data.</li>
                            <li>Object to or restrict certain types of processing.</li>
                            <li>Withdraw consent at any time (where processing is based on consent).</li>
                        </ul>
                        <p className="mt-2">
                            To exercise any of these rights, contact us at <strong>adfliker32@gmail.com</strong>.
                        </p>
                    </Section>

                    <Section title="7. Data Retention">
                        <p>
                            We retain your data for as long as your account is active. Activity logs are automatically
                            deleted after 90 days. Upon account deletion, we will erase your personal data within 30 days,
                            except where retention is required by law.
                        </p>
                    </Section>

                    <Section title="8. Facebook & Meta Platform Data">
                        <p>
                            If you connect your Facebook account to Adfliker CRM, we collect data provided through
                            Meta's platform, including:
                        </p>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                            <li><strong>Facebook Lead Ads:</strong> Lead information submitted through Facebook Lead Ad
                                forms (name, phone, email, city, company) is collected via the Meta Lead Ads API on
                                behalf of our users. This data is stored in the user's CRM workspace solely for lead
                                management purposes and is not sold or shared with third parties.</li>
                            <li><strong>Facebook Pages:</strong> Page IDs and names you authorise us to access, used
                                only to set up lead sync and webhook subscriptions.</li>
                            <li><strong>Access Tokens:</strong> OAuth access tokens are encrypted at rest and used
                                exclusively to retrieve leads and send conversion events on your behalf.</li>
                            <li><strong>Meta Conversions API:</strong> If enabled, lead status events are sent to your
                                own Meta Pixel to help optimise ad delivery. All user data (email, phone) is hashed
                                with SHA-256 before transmission.</li>
                        </ul>
                        <p className="mt-2">
                            We collect only the data necessary to operate the integration and do not access any
                            Facebook data beyond what you explicitly authorise during the OAuth login flow.
                        </p>
                        <p className="mt-2">
                            <strong>Removing Facebook access:</strong> You may revoke Adfliker's access to your
                            Facebook account at any time by going to{' '}
                            <strong>Facebook Settings &rarr; Security and Login &rarr; Apps and Websites</strong>{' '}
                            and removing Adfliker. Upon removal, we will automatically delete your stored Facebook
                            access tokens and disable lead sync. You may also request full deletion of your
                            Facebook-linked data by contacting us at <strong>adfliker32@gmail.com</strong> or
                            through Facebook's own data deletion process, which will trigger an automatic deletion
                            of all associated data from our systems within 30 days.
                        </p>
                    </Section>

                    <Section title="9. Children's Privacy">
                        <p>
                            The Service is not directed at individuals under the age of 18. We do not knowingly collect
                            personal information from minors. If you believe we have inadvertently collected such
                            information, please contact us immediately.
                        </p>
                    </Section>

                    <Section title="10. Changes to This Policy">
                        <p>
                            We may update this Privacy Policy periodically. We will notify you of material changes via
                            in-app notification or email. Continued use of the Service after changes constitutes your
                            acceptance of the updated policy.
                        </p>
                    </Section>

                    <Section title="11. Contact Us">
                        <p>
                            If you have any questions or concerns about this Privacy Policy, please contact us at:{' '}
                            <strong>adfliker32@gmail.com</strong>
                        </p>
                    </Section>
                </div>

                <div className="mt-6 text-center">
                    <Link to="/terms" className="text-teal-600 hover:underline text-sm font-medium">
                        View Terms & Conditions →
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
