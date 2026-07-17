import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors } from '../theme';

export function ClipPlayer({ uri, autoPlay = false }: { uri: string | null; autoPlay?: boolean }) {
  if (!uri) return <View style={styles.missing}><Text style={styles.missingText}>No scene clip is available for this card.</Text></View>;
  return <ActiveClip uri={uri} autoPlay={autoPlay} />;
}

function ActiveClip({ uri, autoPlay }: { uri: string; autoPlay: boolean }) {
  const player = useVideoPlayer(uri, instance => { instance.loop = false; if (autoPlay) instance.play(); });
  useEffect(() => () => player.pause(), [player]);
  return <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />;
}

const styles = StyleSheet.create({
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: '#000' },
  missing: { padding: 18, borderRadius: 14, backgroundColor: colors.panel2 },
  missingText: { color: colors.muted, textAlign: 'center' }
});
