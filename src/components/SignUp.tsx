import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Mail, Lock, Eye, EyeOff, CheckCircle2, Circle, ChevronDown, Building, BookOpen, Shield, Key, Tag } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { refreshProfile } from '../lib/useProfile';

interface SignUpProps {
  onCancel: () => void;
  onSuccess?: (role: string) => void;
}

import React from 'react';
export default function SignUp({ onCancel, onSuccess }: SignUpProps) {
  const isMounted = React.useRef(true);
  React.useEffect(() => { 
    return () => { isMounted.current = false; }; 
  }, []);

  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const refCode = params.get('ref') || params.get('invitation');
      if (refCode) {
        setInvitationCode(refCode.trim().toUpperCase());
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showAccessCode, setShowAccessCode] = useState(false);
  
  const [portal, setPortal] = useState('');
  // Public sign-up is Student-only. This is a constant, not state — there is no
  // control anywhere in this component that can change it, so no UI path can
  // reach the Admin or Lecturer provisioning branches. Typed as plain `string`
  // (not a literal) so the existing `accountType === 'Student'` render guards
  // below keep type-checking unchanged.
  //
  // The real enforcement is server-side: public sign-up cannot self-assign a
  // privileged role because a database trigger rejects it (see
  // 0055_signup_student_only.sql). This constant only removes the UI route.
  const accountType: string = 'Student';
  const [accessCode, setAccessCode] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  
  const [university, setUniversity] = useState('');
  const [course, setCourse] = useState('');
  const [agreed, setAgreed] = useState(false);

  // Validation
  const cleanEmail = email.trim().toLowerCase();
  
  // HTML5 standard email regex
  const isEmailValid = cleanEmail.length === 0 ? false : /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(cleanEmail);
  
  const isStep1Valid = name.trim().length > 0 && isEmailValid;

  const hasMinLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  
  const isStep2Valid = hasMinLength && hasNumber && hasUpper && hasLower && hasSpecial && passwordsMatch;

  // Student is the only account type that can be created here, so the portal /
  // university / course fields are always required.
  const isStep3Valid =
    agreed && portal !== '' && university.trim() !== '' && course.trim() !== '';

  const nextStep = () => {
    setDirection(1);
    setStep(s => Math.min(s + 1, 3));
  };
  
  const prevStep = () => {
    setDirection(-1);
    setStep(s => Math.max(s - 1, 1));
  };

  const generateStudentId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'TBZ-';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };



  const handleCreateAccount = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (!supabase) throw new Error('Supabase client is not initialized');

      const studentId = generateStudentId();
      // Hard-coded, not derived from any input. Admin and Lecturer accounts are
      // provisioned only by an admin through Lecturer Management / the
      // admin-provision-user Edge Function, never through public sign-up.
      const role = 'Student';
      const emailForAuth = cleanEmail;

      // ----------------------------------------------------
      // Student Flow Below
      // ----------------------------------------------------
      const { data: existingProfiles, error: selectError } = await supabase.from('profiles').select('email').eq('email', emailForAuth);
      const isExistingUser = existingProfiles && existingProfiles.length > 0;

      if (isExistingUser) {
        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        
        if (loginError) {
          throw loginError;
        }
        
        let { data: profile } = await supabase.from('profiles').select('*').eq('id', loginData.user.id).single();
        if (!profile) {
           const profilePayload = {
             id: loginData.user.id,
             full_name: name || loginData.user.user_metadata?.full_name || 'User',
             email,
             role: role || loginData.user.user_metadata?.role || 'Student',
             portal: role === 'Student' ? portal : (loginData.user.user_metadata?.portal || 'UTME'),
             university: role === 'Student' ? university : (loginData.user.user_metadata?.university || null),
             course: role === 'Student' ? course : (loginData.user.user_metadata?.course || null),
             student_id: studentId || loginData.user.user_metadata?.student_id || generateStudentId(),
             created_at: new Date().toISOString()
           };
           const { error: upsertErr } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });
           if (upsertErr) {
             throw new Error('Database Error: ' + upsertErr.message);
           }
           const { data: freshProfile } = await supabase.from('profiles').select('*').eq('id', loginData.user.id).single();
           profile = freshProfile;
        }
        
        await refreshProfile();
        setSuccessMsg('Logged in successfully. Redirecting...');
        setTimeout(() => {
          const finalRole = profile?.role || role;
          if (onSuccess && isMounted.current) onSuccess(finalRole);
        }, 100);
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        // emailForAuth is `email.trim().toLowerCase()` — the explicit guarantee
        // that Supabase Auth is never handed an uppercase address from here.
        email: emailForAuth,
        password,
        options: {
          data: {
            full_name: name,
            role: role,
            portal: role === 'Student' ? portal : null,
            university: role === 'Student' ? university : null,
            course: role === 'Student' ? course : null,
            registration_date: new Date().toISOString(),
            premium_status: 'Free',
            student_id: studentId
          }
        }
      });

      if (authError) {
         if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
              email,
              password
            });
            if (loginError) throw loginError;
            
            let { data: profile } = await supabase.from('profiles').select('*').eq('id', loginData.user.id).single();
            if (!profile) {
              const profilePayload = {
                id: loginData.user.id,
                full_name: name || loginData.user.user_metadata?.full_name || 'User',
                email,
                role: role || loginData.user.user_metadata?.role || 'Student',
                portal: role === 'Student' ? portal : (loginData.user.user_metadata?.portal || 'UTME'),
                university: role === 'Student' ? university : (loginData.user.user_metadata?.university || null),
                course: role === 'Student' ? course : (loginData.user.user_metadata?.course || null),
                student_id: studentId || loginData.user.user_metadata?.student_id || generateStudentId(),
                created_at: new Date().toISOString()
              };
              const { error: upsertErr } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });
              if (upsertErr) {
                throw new Error('Database Error: ' + upsertErr.message);
              }
              const { data: freshProfile } = await supabase.from('profiles').select('*').eq('id', loginData.user.id).single();
              profile = freshProfile;
            }
            await refreshProfile();
            setSuccessMsg('Logged in successfully. Redirecting...');
            setTimeout(() => {
              const finalRole = profile?.role || role;
              if (onSuccess && isMounted.current) onSuccess(finalRole);
            }, 100);
            return;
         }
         throw authError;
      }

      let sessionToUse = authData.session;
      if (!sessionToUse && authData.user) {
          const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
            email,
            password
          });
          
          if (!loginError && loginData.session) {
             sessionToUse = loginData.session;
          }
      }

      if (!sessionToUse) {
        throw new Error('Failed to establish session after signup. Email confirmation might be required.');
      }

      const { data: { user: currentUser }, error: getUserError } = await supabase.auth.getUser();
      
      if (getUserError || !currentUser?.id) {
         throw new Error('Authentication incomplete. Cannot create profile.');
      }

      const userId = currentUser.id;
      
      let referredByPartnerId = null;
      if (invitationCode.trim()) {
        const { data: partnerData, error: partnerErr } = await supabase
          .from('partners')
          .select('id')
          .eq('referral_code', invitationCode.trim().toUpperCase())
          .maybeSingle();

        if (partnerErr || !partnerData) {
          throw new Error(`Invalid invitation code "${invitationCode}". Please check the code or leave it blank.`);
        }
        referredByPartnerId = partnerData.id;
      }
      
      const profilePayload = {
        id: userId,
        full_name: name,
        email,
        role: role,
        portal: role === 'Student' ? portal : null,
        university: role === 'Student' ? university : null,
        course: role === 'Student' ? course : null,
        student_id: studentId,
        referred_by_partner_id: referredByPartnerId,
        created_at: new Date().toISOString()
      };
      
      const { error: profileError } = await supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });

      if (profileError) {
        throw new Error('Database Error: ' + profileError.message);
      }
      
      await refreshProfile();
      setSuccessMsg('Registration successful. Redirecting...');
      setTimeout(() => {
        if (onSuccess && isMounted.current) onSuccess(role);
      }, 100);
    } catch (error: any) {
      let msg = error.message || 'Failed to create account.';
      
      if (msg.includes('Invalid login credentials')) {
        msg = 'An account with this email already exists, but the password was incorrect. Please try again.';
      } else if (msg.toLowerCase().includes('password')) {
        msg = 'Weak password. Please use a stronger password.';
      } else if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        msg = 'Too many attempts detected. Please wait a few minutes before trying again.';
      }

      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0
    })
  };

  return (
    <div className="min-h-[100dvh] bg-[#020617] flex items-center justify-center p-4 relative overflow-hidden hero-gradient">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#0f172a]/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-800 p-6 sm:p-8 relative z-10 overflow-hidden"
      >
        <div className="mb-8">
          <p className="text-sm font-poppins font-medium text-amber-500 mb-2 uppercase tracking-widest text-center">
            Step <span className="font-space font-bold">{step}</span> of <span className="font-space font-bold">3</span>
          </p>
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-amber-500 rounded-full"
              initial={{ width: `${((step - 1) / 3) * 100}%` }}
              animate={{ width: `${(step / 3) * 100}%` }}
              transition={{ duration: 0.3 }}
            ></motion.div>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-body rounded-lg text-center">
            {errorMsg}
          </div>
        )}
        
        {successMsg && (
          <div className="mb-6 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-body rounded-lg text-center">
            {successMsg}
          </div>
        )}

        <div className="relative h-[600px] sm:h-[540px] w-full flex flex-col">
          <AnimatePresence mode="popLayout" custom={direction}>
            {step === 1 && (
              <motion.div
                key="step1"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="absolute w-full top-0 left-0"
              >
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-display font-extrabold text-white mb-2">
                    Personal Information
                  </h2>
                  <p className="text-sm font-body font-normal text-slate-400">
                    Let's get started with your account details.
                  </p>
                </div>

                <div className="space-y-5 mb-8">
                  <div>
                    <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                      Full Name
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <User className="h-5 w-5 text-slate-500" />
                      </div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="block w-full pl-11 pr-4 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all font-body font-normal"
                        placeholder="John Doe"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Mail className="h-5 w-5 text-slate-500" />
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          // Emails are held lowercase in state, so every consumer
                          // down the chain — signUp, signInWithPassword and the
                          // profiles row — receives a lowercase address without
                          // the caller having to remember to normalise it.
                          setEmail(e.target.value.toLowerCase());
                          if (emailTouched && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(e.target.value.trim().toLowerCase())) {
                            setEmailTouched(false); // Clear error aggressively when valid
                          }
                        }}
                        onBlur={() => setEmailTouched(true)}
                        className={`block w-full pl-11 pr-4 py-3.5 border ${emailTouched && cleanEmail.length > 0 && !isEmailValid ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-slate-700 focus:ring-amber-500 focus:border-amber-500'} rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 sm:text-sm transition-all font-body font-normal`}
                        placeholder="you@example.com"
                      />
                    </div>
                    {emailTouched && cleanEmail.length > 0 && !isEmailValid && (
                      <p className="mt-1.5 text-xs text-red-400 font-body">Invalid email format.</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 mt-10">
                  <button
                    onClick={onCancel}
                    className="flex-1 py-3.5 px-4 border border-slate-700 rounded-xl text-sm font-action font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!isStep1Valid}
                    onClick={nextStep}
                    className="flex-1 py-3.5 px-4 rounded-xl text-sm font-action font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="absolute w-full top-0 left-0"
              >
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-display font-extrabold text-white mb-2">
                    Security
                  </h2>
                  <p className="text-sm font-body font-normal text-slate-400">
                    Keep your account secure with a strong password.
                  </p>
                </div>

                <div className="space-y-5 mb-6">
                  <div>
                    <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Lock className="h-5 w-5 text-slate-500" />
                      </div>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="block w-full pl-11 pr-12 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all font-body font-normal"
                        placeholder="••••••••"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Lock className="h-5 w-5 text-slate-500" />
                      </div>
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="block w-full pl-11 pr-12 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all font-body font-normal"
                        placeholder="••••••••"
                      />
                      <button 
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-white transition-colors"
                      >
                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 mb-8 bg-slate-900/50 p-5 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    {hasMinLength ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${hasMinLength ? 'text-emerald-500' : 'text-slate-400'} font-body font-normal`}>Minimum 8 characters</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasNumber ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${hasNumber ? 'text-emerald-500' : 'text-slate-400'} font-body font-normal`}>At least one number</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasUpper ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${hasUpper ? 'text-emerald-500' : 'text-slate-400'} font-body font-normal`}>At least one uppercase letter</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasLower ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${hasLower ? 'text-emerald-500' : 'text-slate-400'} font-body font-normal`}>At least one lowercase letter</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {hasSpecial ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${hasSpecial ? 'text-emerald-500' : 'text-slate-400'} font-body font-normal`}>At least one special character</span>
                  </div>
                  <div className="flex items-center gap-3 pt-2 mt-1 border-t border-slate-800">
                    {passwordsMatch ? <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                    <span className={`text-xs ${passwordsMatch ? 'text-amber-500 font-bold' : 'text-slate-400'} font-body font-normal`}>Passwords match</span>
                  </div>
                </div>

                <div className="flex gap-4 mt-6">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3.5 px-4 border border-slate-700 rounded-xl text-sm font-action font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    disabled={!isStep2Valid}
                    onClick={nextStep}
                    className="flex-1 py-3.5 px-4 rounded-xl text-sm font-action font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="absolute w-full h-full top-0 left-0 overflow-y-auto custom-scrollbar pb-6 pr-2"
              >
                <div className="text-center mb-6">
                  <h2 className="text-3xl font-display font-extrabold text-white mb-2">
                    Final Step
                  </h2>
                  <p className="text-sm font-body font-normal text-slate-400">
                    Tell us about your studies to complete registration.
                  </p>
                </div>

                <div className="space-y-5 mb-8">
                  <AnimatePresence mode="wait">
                    {accountType === 'Student' && (
                      <motion.div
                        key="student-fields"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-5 overflow-hidden"
                      >
                        <div>
                          <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                            Academic Portal
                          </label>
                          <div className="relative">
                            <select
                              value={portal}
                              onChange={(e) => setPortal(e.target.value)}
                              className="block w-full pl-4 pr-10 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all appearance-none font-body font-normal"
                            >
                              <option value="" disabled>Select Academic Portal</option>
                              <option value="UTME">UTME</option>
                              <option value="Post-UTME">Post-UTME</option>
                              <option value="Undergraduate">Undergraduate</option>
                            </select>
                            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                              <ChevronDown className="h-5 w-5 text-slate-500" />
                            </div>
                          </div>
                        </div>

                        {(portal === 'UTME' || portal === 'Post-UTME' || portal === 'Undergraduate') && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-5"
                          >
                            <div>
                              <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                                {portal === 'Undergraduate' ? 'Current University' : 'University of Choice'}
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                  <Building className="h-5 w-5 text-slate-500" />
                                </div>
                                <select
                                  value={university}
                                  onChange={(e) => setUniversity(e.target.value)}
                                  className="block w-full pl-11 pr-10 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all appearance-none font-body font-normal"
                                >
                                  <option value="" disabled>Select University</option>
                                  <option value="Unilorin">University of Ilorin (Unilorin)</option>
                                  <option value="Unilag">University of Lagos (Unilag)</option>
                                  <option value="OAU">Obafemi Awolowo University (OAU)</option>
                                  <option value="UI">University of Ibadan (UI)</option>
                                  <option value="Other">Other</option>
                                </select>
                                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                                  <ChevronDown className="h-5 w-5 text-slate-500" />
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                                {portal === 'Undergraduate' ? 'Current Course of Study' : 'Intended Course of Study'}
                              </label>
                              <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                  <BookOpen className="h-5 w-5 text-slate-500" />
                                </div>
                                <input
                                  type="text"
                                  value={course}
                                  onChange={(e) => setCourse(e.target.value)}
                                  className="block w-full pl-11 pr-4 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all font-body font-normal"
                                  placeholder="e.g. Computer Science"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    )}

                  </AnimatePresence>

                  <div className="pt-3">
                    <label className="block text-sm font-poppins font-medium text-slate-400 mb-1.5">
                      Invitation Code (Optional)
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Tag className="h-5 w-5 text-slate-500" />
                      </div>
                      <input
                        type="text"
                        value={invitationCode}
                        onChange={(e) => setInvitationCode(e.target.value.toUpperCase())}
                        className="block w-full pl-11 pr-4 py-3.5 border border-slate-700 rounded-xl leading-5 bg-[#020617]/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 sm:text-sm transition-all font-body font-normal uppercase font-mono"
                        placeholder="e.g. EMMA20"
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center shrink-0">
                        <input
                          type="checkbox"
                          checked={agreed}
                          onChange={(e) => setAgreed(e.target.checked)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded border ${agreed ? 'bg-amber-500 border-amber-500' : 'border-slate-600 group-hover:border-slate-500'} transition-colors flex items-center justify-center`}>
                          {agreed && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
                        </div>
                      </div>
                      <span className="text-sm font-body font-normal text-slate-400 group-hover:text-slate-300 transition-colors">
                        I agree to the <a href="#" className="text-amber-500 hover:underline">Terms of Service</a> and <a href="#" className="text-amber-500 hover:underline">Privacy Policy</a>.
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-4 mt-6">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3.5 px-4 border border-slate-700 rounded-xl text-sm font-action font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    disabled={!isStep3Valid || isLoading}
                    onClick={handleCreateAccount}
                    className="flex-1 py-3.5 px-4 rounded-xl text-sm font-action font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none flex items-center justify-center"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4 text-slate-950" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating...
                      </span>
                    ) : (
                      "Create Account"
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

