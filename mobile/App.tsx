import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { flattenLibrary, languageLabel, type LearningLibrary, type LibraryContext, type LibraryItem } from '@vpll/core';
import { clearLibrary, importDesktopBundle, loadLibrary, resolveClipUri } from './src/services/libraryStorage';
import { StudyCardModal } from './src/components/StudyCardModal';
import { colors } from './src/theme';

type Selected = { item: LibraryItem; context: LibraryContext } | null;

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

function AppContent() {
  const [library, setLibrary] = useState<LearningLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected>(null);

  useEffect(() => { loadLibrary().then(setLibrary).catch(error => Alert.alert('Library error', error.message)).finally(() => setLoading(false)); }, []);
  const cards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    return library ? flattenLibrary(library).filter(({ item, context }) => !normalized || [item.term, item.lemma, context.sourceSentence, context.translatedSentence].join(' ').toLocaleLowerCase('en').includes(normalized)) : [];
  }, [library, query]);

  async function handleImport() {
    setImporting(true);
    try { const imported = await importDesktopBundle(); if (imported) setLibrary(imported); }
    catch (error) { Alert.alert('Import failed', error instanceof Error ? error.message : String(error)); }
    finally { setImporting(false); }
  }

  async function handleClear() {
    Alert.alert('Remove mobile library?', 'This only removes the imported mobile copy. Your desktop library is not changed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await clearLibrary(); setLibrary(null); } }
    ]);
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="light" />
    <View style={styles.header}>
      <View><Text style={styles.eyebrow}>VIDEO PLAYER</Text><Text style={styles.title}>LanguageLearning Mobile</Text><Text style={styles.subtitle}>{cards.length} study cards available offline</Text></View>
      {library ? <Pressable onPress={handleClear}><Text style={styles.clear}>Clear</Text></Pressable> : null}
    </View>
    {!library ? <Empty importing={importing} onImport={handleImport} /> : <>
      <View style={styles.toolbar}><TextInput value={query} onChangeText={setQuery} placeholder="Search words or sentences" placeholderTextColor={colors.muted} style={styles.search}/><Pressable style={styles.importSmall} onPress={handleImport} disabled={importing}><Text style={styles.importSmallText}>{importing ? 'Importing…' : 'Replace bundle'}</Text></Pressable></View>
      <FlatList data={cards} keyExtractor={card => card.key} contentContainerStyle={styles.list} renderItem={({ item: card }) => <Pressable style={styles.card} onPress={() => setSelected({ item: card.item, context: card.context })}>
        <View style={styles.cardTop}><Text style={styles.term}>{card.item.term}</Text><Text style={styles.level}>{card.context.cefrLevel}</Text></View>
        <Text numberOfLines={2} style={styles.sentence}>{card.context.sourceSentence}</Text>
        <Text style={styles.meta}>{languageLabel(card.context.targetLanguage)} · {card.context.partOfSpeech || card.item.unitType}</Text>
      </Pressable>} ListEmptyComponent={<Text style={styles.noResults}>No matching cards.</Text>} />
    </>}
    {selected ? <StudyCardModal visible item={selected.item} context={selected.context} clipUri={resolveClipUri(selected.context)} onClose={() => setSelected(null)} /> : null}
  </SafeAreaView>;
}

function Empty({ importing, onImport }: { importing: boolean; onImport: () => void }) {
  return <View style={styles.empty}><Text style={styles.emptyIcon}>▶</Text><Text style={styles.emptyTitle}>Bring your learning library to mobile</Text><Text style={styles.emptyText}>On desktop, open Library and choose “Mobile aktar”. Move the generated ZIP to this phone, then import it here. Words, context, definitions and scene clips remain available offline.</Text><Pressable style={styles.primary} onPress={onImport} disabled={importing}><Text style={styles.primaryText}>{importing ? 'Importing bundle…' : 'Import desktop bundle'}</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},center:{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center'},header:{paddingHorizontal:20,paddingTop:14,paddingBottom:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},eyebrow:{fontSize:11,letterSpacing:2,fontWeight:'800',color:colors.accent},title:{fontSize:25,fontWeight:'900',color:colors.text,marginTop:3},subtitle:{fontSize:13,color:colors.muted,marginTop:4},clear:{color:colors.danger,fontWeight:'700'},toolbar:{paddingHorizontal:20,paddingBottom:12,gap:10},search:{height:48,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.panel,paddingHorizontal:15,color:colors.text,fontSize:16},importSmall:{alignSelf:'flex-end'},importSmallText:{color:colors.accent,fontWeight:'700'},list:{padding:20,paddingTop:4,gap:12,paddingBottom:50},card:{padding:17,borderRadius:17,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,gap:9},cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},term:{fontSize:23,fontWeight:'900',color:colors.text,flex:1},level:{paddingHorizontal:9,paddingVertical:4,borderRadius:9,overflow:'hidden',backgroundColor:colors.accentDark,color:colors.accent,fontWeight:'800'},sentence:{fontSize:16,lineHeight:23,color:colors.text},meta:{fontSize:13,color:colors.muted},empty:{flex:1,paddingHorizontal:30,alignItems:'center',justifyContent:'center',gap:16},emptyIcon:{fontSize:40,color:colors.accent},emptyTitle:{fontSize:27,lineHeight:34,textAlign:'center',fontWeight:'900',color:colors.text},emptyText:{fontSize:16,lineHeight:24,textAlign:'center',color:colors.muted},primary:{marginTop:8,paddingHorizontal:22,paddingVertical:15,borderRadius:14,backgroundColor:colors.accent},primaryText:{fontSize:16,fontWeight:'900',color:'#06120f'},noResults:{color:colors.muted,textAlign:'center',marginTop:40}
});
