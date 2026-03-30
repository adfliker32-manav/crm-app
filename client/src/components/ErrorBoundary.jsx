import React from 'react';

/**
 * ErrorBoundary — catches runtime errors in any child component tree.
 * Prevents the entire app from going blank on an unexpected JS error.
 *
 * Usage: wrap around major routes in App.jsx
 *   <ErrorBoundary>
 *       <Dashboard />
 *   </ErrorBoundary>
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        // Log to console (replace with your monitoring service later)
        console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.href = '/dashboard';
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#fafafa',
                fontFamily: 'Inter, sans-serif',
                padding: '2rem',
                textAlign: 'center'
            }}>
                <div style={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '16px',
                    padding: '3rem',
                    maxWidth: '480px',
                    boxShadow: '0 4px 40px rgba(0,0,0,0.06)'
                }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111', marginBottom: '0.75rem' }}>
                        Something went wrong
                    </h1>
                    <p style={{ color: '#6b7280', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                        An unexpected error occurred. Your data is safe. Please try going back to the dashboard.
                    </p>
                    {process.env.NODE_ENV === 'development' && this.state.error && (
                        <pre style={{
                            background: '#fee2e2', color: '#991b1b',
                            borderRadius: '8px', padding: '1rem',
                            fontSize: '0.75rem', textAlign: 'left',
                            marginBottom: '1.5rem', overflowX: 'auto',
                            whiteSpace: 'pre-wrap'
                        }}>
                            {this.state.error.toString()}
                        </pre>
                    )}
                    <button onClick={this.handleReset} style={{
                        background: '#111', color: 'white',
                        border: 'none', borderRadius: '10px',
                        padding: '0.75rem 2rem', fontWeight: 600,
                        fontSize: '0.9rem', cursor: 'pointer'
                    }}>
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
