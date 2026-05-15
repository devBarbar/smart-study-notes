import 'react-native-get-random-values';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useEffect } from 'react';
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { LanguageProvider } from '@/contexts/language-context';
import { Colors } from '@/constants/theme';
import { wrapWithTelemetry } from '@/lib/sentry';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!user && !inAuthGroup) {
      // Redirect to sign-in if not authenticated
      router.replace('/auth/sign-in');
    } else if (user && inAuthGroup) {
      // Redirect to home if already authenticated
      router.replace('/');
    }
  }, [user, segments, isLoading, router]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: palette.background }]}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="auth" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      <Stack.Screen name="lecture/new" options={{ title: 'New Lecture' }} />
      <Stack.Screen name="lecture/[id]" options={{ title: 'Lecture' }} />
      <Stack.Screen name="material/[id]" options={{ title: 'Material' }} />
      <Stack.Screen name="study/[sessionId]" options={{ title: 'Study Session' }} />
      <Stack.Screen name="practice/[examId]" options={{ title: 'Practice Exam' }} />
    </Stack>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();
  const queryClient = useMemo(() => new QueryClient(), []);
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const RootView = Platform.OS === 'web' ? View : GestureHandlerRootView;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LanguageProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootView style={{ flex: 1, backgroundColor: palette.background }}>
              <RootLayoutNav />
            </RootView>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          </ThemeProvider>
        </LanguageProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default wrapWithTelemetry(RootLayout);

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
