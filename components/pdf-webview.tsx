import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  uri: string;
};

export const PdfWebView = ({ uri }: Props) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [useGoogleViewer, setUseGoogleViewer] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayUri = useMemo(() => {
    if (!uri) return '';
    if (!useGoogleViewer) return uri;
    if (uri.includes('docs.google.com/gview')) return uri;
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(uri)}`;
  }, [uri, useGoogleViewer]);

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    setUseGoogleViewer(true);
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Auto-hide spinner after 5 seconds as a fallback
    // Google Docs viewer sometimes doesn't trigger onLoadEnd reliably
    timeoutRef.current = setTimeout(() => {
      setLoaded(true);
    }, 5000);
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [uri]);

  return (
    <View style={styles.container}>
      {!loaded && !errored && (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      )}
      {!errored ? (
        <WebView
          source={{ uri: displayUri }}
          onLoadEnd={() => {
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            setLoaded(true);
          }}
          onError={() => {
            // Retry once without Google viewer; if already direct, surface error UI.
            if (useGoogleViewer) {
              setUseGoogleViewer(false);
              setLoaded(false);
            } else {
              setErrored(true);
              setLoaded(true);
            }
          }}
          originWhitelist={['*']}
          style={styles.webview}
          scrollEnabled
          allowsBackForwardNavigationGestures
        />
      ) : (
        <View style={styles.errorBox}>
          <Pressable onPress={() => Linking.openURL(uri)}>
            <View style={styles.retry}>
              <Text style={styles.errorText}>Open PDF in browser</Text>
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 340,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  webview: {
    flex: 1,
  },
  loading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
  },
  retry: {
    marginTop: 8,
  },
  errorText: {
    color: '#0f172a',
    fontWeight: '600',
  },
});

