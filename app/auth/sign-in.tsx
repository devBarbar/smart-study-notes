import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/contexts/auth-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';

type AuthMode = 'sign-in' | 'sign-up' | 'forgot-password';

export default function SignInScreen() {
  const { 
    signInWithApple, 
    signInWithEmail, 
    signUpWithEmail, 
    resetPassword,
    isLoading, 
    isAppleAuthAvailable 
  } = useAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { t } = useLanguage();

  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAppleSignIn = async () => {
    try {
      setError(null);
      await signInWithApple();
    } catch (err) {
      console.error('Sign in error:', err);
      setError('Apple Sign-In failed. Please try again.');
    }
  };

  const handleEmailSignIn = async () => {
    if (!email || !password) {
      setError(t('auth.error.missingCredentials'));
      return;
    }
    
    try {
      setError(null);
      await signInWithEmail(email, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      setError(t('auth.error.missingFields'));
      return;
    }
    
    if (password !== confirmPassword) {
      setError(t('auth.error.passwordMismatch'));
      return;
    }
    
    if (password.length < 6) {
      setError(t('auth.error.passwordLength'));
      return;
    }
    
    try {
      setError(null);
      const { needsEmailConfirmation } = await signUpWithEmail(email, password);
      
      if (needsEmailConfirmation) {
        Alert.alert(
          t('auth.alert.checkEmailTitle'),
          t('auth.alert.checkEmailSignup'),
          [{ text: t('common.ok'), onPress: () => setMode('sign-in') }]
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      setError(message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError(t('auth.error.missingCredentials'));
      return;
    }
    
    try {
      setError(null);
      await resetPassword(email);
      Alert.alert(
        t('auth.alert.checkEmailTitle'),
        t('auth.alert.checkEmailReset'),
        [{ text: t('common.ok'), onPress: () => setMode('sign-in') }]
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(message);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
      color: colors.text,
      borderColor: isDark ? '#374151' : '#d1d5db',
    },
  ];

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: colors.tint }]}>
              <ThemedText style={styles.iconText}>📚</ThemedText>
            </View>
            <ThemedText type="title" style={styles.title}>
              {t('common.appName')}
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: colors.icon }]}>
              {mode === 'sign-in' && t('auth.subtitle.signIn')}
              {mode === 'sign-up' && t('auth.subtitle.signUp')}
              {mode === 'forgot-password' && t('auth.subtitle.forgot')}
            </ThemedText>
          </View>

          {/* Error Message */}
          {error && (
            <View style={styles.errorContainer}>
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            </View>
          )}

          {/* Email Form */}
          <View style={styles.form}>
            <TextInput
              style={inputStyle}
              placeholder={t('auth.placeholder.email')}
              placeholderTextColor={colors.icon}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!isLoading}
            />
            
            {mode !== 'forgot-password' && (
              <TextInput
                style={inputStyle}
                placeholder={t('auth.placeholder.password')}
                placeholderTextColor={colors.icon}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                editable={!isLoading}
              />
            )}
            
            {mode === 'sign-up' && (
              <TextInput
                style={inputStyle}
                placeholder={t('auth.placeholder.confirmPassword')}
                placeholderTextColor={colors.icon}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoComplete="new-password"
                editable={!isLoading}
              />
            )}

            {/* Primary Action Button */}
            <Pressable
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={() => {
                if (mode === 'sign-in') handleEmailSignIn();
                else if (mode === 'sign-up') handleEmailSignUp();
                else handleForgotPassword();
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.primaryButtonText}>
                  {mode === 'sign-in' && t('auth.button.signIn')}
                  {mode === 'sign-up' && t('auth.button.createAccount')}
                  {mode === 'forgot-password' && t('auth.button.reset')}
                </ThemedText>
              )}
            </Pressable>

            {/* Secondary Links */}
            {mode === 'sign-in' && (
              <>
                <Pressable onPress={() => { setMode('forgot-password'); setError(null); }}>
                  <ThemedText style={[styles.linkText, { color: colors.tint }]}>
                    {t('auth.link.forgot')}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => { setMode('sign-up'); setError(null); }}>
                  <ThemedText style={[styles.linkText, { color: colors.tint }]}>
                    {t('auth.link.signup')}
                  </ThemedText>
                </Pressable>
              </>
            )}
            
            {mode === 'sign-up' && (
              <Pressable onPress={() => { setMode('sign-in'); setError(null); }}>
                <ThemedText style={[styles.linkText, { color: colors.tint }]}>
                  {t('auth.link.signin')}
                </ThemedText>
              </Pressable>
            )}
            
            {mode === 'forgot-password' && (
              <Pressable onPress={() => { setMode('sign-in'); setError(null); }}>
                <ThemedText style={[styles.linkText, { color: colors.tint }]}>
                  {t('auth.link.backToSignIn')}
                </ThemedText>
              </Pressable>
            )}
          </View>

          {/* Divider - Only show on sign-in mode */}
          {mode === 'sign-in' && Platform.OS === 'ios' && isAppleAuthAvailable && (
            <>
              <View style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.icon }]} />
                <ThemedText style={[styles.dividerText, { color: colors.icon }]}>{t('auth.divider.or')}</ThemedText>
                <View style={[styles.dividerLine, { backgroundColor: colors.icon }]} />
              </View>

              {/* Apple Sign In */}
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  isDark
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={12}
                style={styles.appleButton}
                onPress={handleAppleSignIn}
              />
            </>
          )}

          {/* Footer */}
          <ThemedText style={[styles.footer, { color: colors.icon }]}>
            {t('auth.footer.terms')}
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 36,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 16,
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
  form: {
    gap: 12,
  },
  input: {
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  primaryButton: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkText: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    opacity: 0.3,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  appleButton: {
    width: '100%',
    height: 52,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 24,
    paddingHorizontal: 20,
  },
});
