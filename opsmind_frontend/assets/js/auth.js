/**
 * OpsMind - Authentication Page Module
 * 
 * Handles complete authentication flow:
 * - Sign up with email validation
 * - OTP verification (for signup and login)
 * - Login with OTP
 * - Password validation
 * - Form validation
 */

import AuthService from '/services/authService.js';

/**
 * Get role-based dashboard URL
 * @returns {string} Dashboard URL based on user role
 */
function getRoleBasedDashboard() {
    const user = AuthService.getCurrentUser();
    const role = user?.role?.toUpperCase();
    
    // Route to specific dashboard based on role
    switch(role) {
        case 'STUDENT':
        case 'DOCTOR':
            return 'dashboard.html';
        
        case 'TECHNICIAN':
        case 'JUNIOR':
            return 'junior-dashboard.html';
        
        case 'SENIOR':
            return 'senior-dashboard.html';
        
        case 'SUPERVISOR':
            return 'supervisor-dashboard.html';
        
        case 'ADMIN':
            return 'senior-dashboard.html';  // Admin sees advanced dashboard
        
        default:
            return 'dashboard.html';  // Fallback to basic dashboard
    }
}

/**
 * Initialize the login page
 */
function initLoginPage() {
    console.log('🚀 Initializing login page...');
    
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const otpForm = document.getElementById('otpForm');
    const cardWrapper = document.querySelector('.login-card-wrapper');
    const showSignupBtn = document.getElementById('showSignup');
    const showLoginBtn = document.getElementById('showLogin');
    
    console.log('📋 Elements found:', {
        cardWrapper: !!cardWrapper,
        showSignupBtn: !!showSignupBtn,
        showLoginBtn: !!showLoginBtn
    });
    
    // Login form elements
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const loginButton = document.getElementById('loginButton');
    const loginError = document.getElementById('loginError');
    const loginErrorMessage = document.getElementById('loginErrorMessage');
    
    // Signup form elements
    const firstNameInput = document.getElementById('firstName');
    const lastNameInput = document.getElementById('lastName');
    const signupEmailInput = document.getElementById('signupEmail');
    const signupPasswordInput = document.getElementById('signupPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const toggleSignupPasswordBtn = document.getElementById('toggleSignupPassword');
    const signupButton = document.getElementById('signupButton');
    const signupError = document.getElementById('signupError');
    const signupErrorMessage = document.getElementById('signupErrorMessage');
    
    // OTP modal elements
    const otpModal = new bootstrap.Modal(document.getElementById('otpModal'));
    const otpModalTitle = document.getElementById('otpModalTitle');
    const otpEmail = document.getElementById('otpEmail');
    const otpCode = document.getElementById('otpCode');
    const otpInstructions = document.getElementById('otpInstructions');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpError = document.getElementById('otpError');
    const otpErrorMessage = document.getElementById('otpErrorMessage');
    const otpSuccess = document.getElementById('otpSuccess');
    const otpSuccessMessage = document.getElementById('otpSuccessMessage');
    const closeOtpModal = document.getElementById('closeOtpModal');

    // Check if already authenticated
    if (AuthService.isAuthenticated()) {
        window.location.href = getRoleBasedDashboard();
        return;
    }

    // Check if there's a pending OTP verification on page load
    const pendingVerification = AuthService.getPendingVerification();
    if (pendingVerification) {
        showOTPModal(pendingVerification.email, pendingVerification.purpose);
    }

    /**
     * Toggle between Sign In and Sign Up forms
     */
    showSignupBtn?.addEventListener('click', (e) => {
        console.log('🔄 Sign Up clicked - flipping card...');
        e.preventDefault();
        cardWrapper?.classList.add('flipped');
        hideError();
        hideSignupError();
    });

    showLoginBtn?.addEventListener('click', (e) => {
        console.log('🔄 Sign In clicked - flipping card back...');
        e.preventDefault();
        cardWrapper?.classList.remove('flipped');
        hideError();
        hideSignupError();
    });

    /**
     * Toggle password visibility for login
     */
    togglePasswordBtn?.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        const icon = togglePasswordBtn.querySelector('i');
        icon.classList.toggle('bi-eye');
        icon.classList.toggle('bi-eye-slash');
    });

    /**
     * Toggle password visibility for signup
     */
    toggleSignupPasswordBtn?.addEventListener('click', () => {
        const type = signupPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        signupPasswordInput.setAttribute('type', type);
        
        const icon = toggleSignupPasswordBtn.querySelector('i');
        icon.classList.toggle('bi-eye');
        icon.classList.toggle('bi-eye-slash');
    });

    /**
     * Show error message for login
     */
    function showError(message) {
        loginErrorMessage.textContent = message;
        loginError.classList.remove('d-none');
        loginError.classList.add('shake');
        setTimeout(() => loginError.classList.remove('shake'), 500);
    }

    /**
     * Hide login error message
     */
    function hideError() {
        loginError.classList.add('d-none');
    }

    /**
     * Show signup error message
     */
    function showSignupError(message) {
        signupErrorMessage.textContent = message;
        signupError.classList.remove('d-none');
        signupError.classList.add('shake');
        setTimeout(() => signupError.classList.remove('shake'), 500);
    }

    /**
     * Hide signup error message
     */
    function hideSignupError() {
        signupError.classList.add('d-none');
    }

    /**
     * Show OTP error message
     */
    function showOTPError(message) {
        otpErrorMessage.textContent = message;
        otpError.classList.remove('d-none');
        otpError.classList.add('shake');
        setTimeout(() => otpError.classList.remove('shake'), 500);
        hideOTPSuccess();
    }

    /**
     * Hide OTP error message
     */
    function hideOTPError() {
        otpError.classList.add('d-none');
    }

    /**
     * Show OTP success message
     */
    function showOTPSuccess(message) {
        otpSuccessMessage.textContent = message;
        otpSuccess.classList.remove('d-none');
        hideOTPError();
    }

    /**
     * Hide OTP success message
     */
    function hideOTPSuccess() {
        otpSuccess.classList.add('d-none');
    }

    /**
     * Set loading state on login button
     */
    function setLoading(loading) {
        const btnText = loginButton.querySelector('.btn-text');
        const btnLoader = loginButton.querySelector('.btn-loader');
        
        if (loading) {
            loginButton.disabled = true;
            btnText.classList.add('d-none');
            btnLoader.classList.remove('d-none');
        } else {
            loginButton.disabled = false;
            btnText.classList.remove('d-none');
            btnLoader.classList.add('d-none');
        }
    }

    /**
     * Set loading state on signup button
     */
    function setSignupLoading(loading) {
        const btnText = signupButton.querySelector('.btn-text');
        const btnLoader = signupButton.querySelector('.btn-loader');
        
        if (loading) {
            signupButton.disabled = true;
            btnText.classList.add('d-none');
            btnLoader.classList.remove('d-none');
        } else {
            signupButton.disabled = false;
            btnText.classList.remove('d-none');
            btnLoader.classList.add('d-none');
        }
    }

    /**
     * Set loading state on OTP verify button
     */
    function setOTPLoading(loading) {
        const btnText = verifyOtpBtn.querySelector('.btn-text');
        const btnLoader = verifyOtpBtn.querySelector('.btn-loader');
        
        if (loading) {
            verifyOtpBtn.disabled = true;
            resendOtpBtn.disabled = true;
            btnText.classList.add('d-none');
            btnLoader.classList.remove('d-none');
        } else {
            verifyOtpBtn.disabled = false;
            resendOtpBtn.disabled = false;
            btnText.classList.remove('d-none');
            btnLoader.classList.add('d-none');
        }
    }

    /**
     * Validate email format
     */
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Show OTP verification modal
     */
    function showOTPModal(email, purpose) {
        otpEmail.textContent = email;
        otpCode.value = '';
        hideOTPError();
        hideOTPSuccess();
        
        // Update modal title and instructions based on purpose
        if (purpose === 'VERIFICATION') {
            otpModalTitle.textContent = 'Verify Your Email';
            otpInstructions.innerHTML = `We've sent a verification code to <strong>${email}</strong>. Please enter the 6-digit code below to verify your account.`;
        } else {
            otpModalTitle.textContent = 'Enter Login Code';
            otpInstructions.innerHTML = `We've sent a login code to <strong>${email}</strong>. Please enter the 6-digit code below to complete sign in.`;
        }
        
        otpModal.show();
        setTimeout(() => otpCode.focus(), 300);
    }

    /**
     * Handle login form submission
     */
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        // Client-side validation
        if (!email) {
            showError('Please enter your email address.');
            emailInput.focus();
            return;
        }

        if (!isValidEmail(email)) {
            showError('Please enter a valid email address.');
            emailInput.focus();
            return;
        }

        if (!AuthService.validateMIUEmail(email)) {
            showError('Email must end with @miuegypt.edu.eg');
            emailInput.focus();
            return;
        }

        if (!password) {
            showError('Please enter your password.');
            passwordInput.focus();
            return;
        }

        // Attempt login
        setLoading(true);

        try {
            const response = await AuthService.login(email, password);
            setLoading(false);
            
            // Show OTP modal
            const pending = AuthService.getPendingVerification();
            showOTPModal(pending.email, pending.purpose);
            
        } catch (error) {
            setLoading(false);
            showError(error.message || 'An error occurred. Please try again.');
        }
    });

    /**
     * Handle signup form submission
     */
    signupForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideSignupError();

        const firstName = firstNameInput.value.trim();
        const lastName = lastNameInput.value.trim();
        const email = signupEmailInput.value.trim();
        const password = signupPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const accountType = document.querySelector('input[name="accountType"]:checked')?.value;
        const agreeTerms = document.getElementById('agreeTerms').checked;

        // Client-side validation
        if (!firstName) {
            showSignupError('Please enter your first name.');
            firstNameInput.focus();
            return;
        }

        if (!lastName) {
            showSignupError('Please enter your last name.');
            lastNameInput.focus();
            return;
        }

        if (!email) {
            showSignupError('Please enter your email address.');
            signupEmailInput.focus();
            return;
        }

        if (!isValidEmail(email)) {
            showSignupError('Please enter a valid email address.');
            signupEmailInput.focus();
            return;
        }

        if (!AuthService.validateMIUEmail(email)) {
            showSignupError('Email must end with @miuegypt.edu.eg');
            signupEmailInput.focus();
            return;
        }

        if (!password) {
            showSignupError('Please enter a password.');
            signupPasswordInput.focus();
            return;
        }

        // Validate password strength
        const passwordValidation = AuthService.validatePassword(password);
        if (!passwordValidation.valid) {
            showSignupError(passwordValidation.errors[0]);
            signupPasswordInput.focus();
            return;
        }

        if (password !== confirmPassword) {
            showSignupError('Passwords do not match.');
            confirmPasswordInput.focus();
            return;
        }

        if (!accountType) {
            showSignupError('Please select an account type.');
            return;
        }

        if (!agreeTerms) {
            showSignupError('You must agree to the terms and conditions.');
            return;
        }

        // Attempt signup
        setSignupLoading(true);

        try {
            // Map frontend role names to backend expectations
            const roleMapping = {
                'professor': 'DOCTOR',
                'student': 'STUDENT'
            };
            
            const response = await AuthService.signup({
                firstName,
                lastName,
                email,
                password,
                role: roleMapping[accountType]
            });
            
            setSignupLoading(false);
            
            // Show success message and OTP modal
            showOTPModal(email, 'VERIFICATION');
            
        } catch (error) {
            setSignupLoading(false);
            showSignupError(error.message || 'An error occurred. Please try again.');
        }
    });

    /**
     * Handle OTP form submission
     */
    otpForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideOTPError();
        hideOTPSuccess();

        const code = otpCode.value.trim();
        const pending = AuthService.getPendingVerification();

        if (!pending) {
            showOTPError('Session expired. Please try again.');
            return;
        }

        if (!code || code.length !== 6) {
            showOTPError('Please enter a valid 6-digit code.');
            otpCode.focus();
            return;
        }

        setOTPLoading(true);

        try {
            console.log('🔐 Verifying OTP for:', pending.email, 'Purpose:', pending.purpose);
            const response = await AuthService.verifyOTP(pending.email, code, pending.purpose);
            console.log('✅ OTP verification response:', response);
            setOTPLoading(false);
            
            if (pending.purpose === 'VERIFICATION') {
                // Account verified, backend sends LOGIN OTP
                console.log('📧 Account verified, awaiting LOGIN OTP...');
                showOTPSuccess('✓ Account verified! Check your email for login code.');
                otpCode.value = '';
                
                // Wait 2 seconds then update modal for LOGIN
                setTimeout(() => {
                    const newPending = AuthService.getPendingVerification();
                    console.log('🔄 Checking for LOGIN OTP pending:', newPending);
                    if (newPending && newPending.purpose === 'LOGIN') {
                        showOTPModal(newPending.email, 'LOGIN');
                    }
                }, 2000);
                
            } else if (pending.purpose === 'LOGIN') {
                // Login successful
                console.log('✅ Login successful! Auth data stored.');
                const user = AuthService.getCurrentUser();
                console.log('👤 Current user:', user);
                const dashboardUrl = getRoleBasedDashboard();
                console.log('🚀 Redirecting to:', dashboardUrl);
                
                showOTPSuccess('✓ Login successful! Redirecting...');
                
                // Hide modal and redirect immediately
                try {
                    const modalElement = document.getElementById('otpModal');
                    if (modalElement) {
                        const modalInstance = bootstrap.Modal.getInstance(modalElement);
                        if (modalInstance) {
                            modalInstance.hide();
                        }
                    }
                } catch (e) {
                    console.warn('Modal hide failed:', e);
                }
                
                // Force redirect after brief delay
                setTimeout(() => {
                    console.log('🔄 Executing redirect to:', dashboardUrl);
                    window.location.href = dashboardUrl;
                }, 800);
            }
            
        } catch (error) {
            console.error('❌ OTP verification error:', error);
            setOTPLoading(false);
            showOTPError(error.message || 'Invalid code. Please try again.');
            otpCode.value = '';
            otpCode.focus();
        }
    });

    /**
     * Handle resend OTP
     */
    resendOtpBtn?.addEventListener('click', async () => {
        const pending = AuthService.getPendingVerification();
        
        if (!pending) {
            showOTPError('Session expired. Please try again.');
            return;
        }

        resendOtpBtn.disabled = true;
        hideOTPError();

        try {
            await AuthService.resendOTP(pending.email, pending.purpose);
            showOTPSuccess('✓ Code resent! Check your email.');
            
            setTimeout(() => {
                resendOtpBtn.disabled = false;
                hideOTPSuccess();
            }, 3000);
            
        } catch (error) {
            showOTPError(error.message || 'Failed to resend code.');
            resendOtpBtn.disabled = false;
        }
    });

    /**
     * Handle OTP modal close
     */
    closeOtpModal?.addEventListener('click', () => {
        // Clear pending verification when modal is closed
        AuthService.clearPendingVerification();
        otpCode.value = '';
        hideOTPError();
        hideOTPSuccess();
    });

    /**
     * Auto-format OTP input (numbers only)
     */
    otpCode?.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    });

    /**
     * Clear errors on input change
     */
    emailInput?.addEventListener('input', hideError);
    passwordInput?.addEventListener('input', hideError);
    signupEmailInput?.addEventListener('input', hideSignupError);
    signupPasswordInput?.addEventListener('input', hideSignupError);
    confirmPasswordInput?.addEventListener('input', hideSignupError);

    // Focus on email input on page load
    emailInput?.focus();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initLoginPage);
