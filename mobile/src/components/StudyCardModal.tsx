import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LibraryContext, LibraryItem } from '@vpll/core';
import { ClipPlayer } from './ClipPlayer';
import { colors } from '../theme';

export function StudyCardModal({ item, context, clipUri, visible, onClose }: {
  item: LibraryItem; context: LibraryContext; clipUri: string | null; visible: boolean; onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { if (visible) setRevealed(false); }, [visible, item.id, context.id]);

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
    <View style={styles.screen}>
      <View style={styles.header}><Text style={styles.title}>Study card</Text><Pressable onPress={onClose}><Text style={styles.close}>Close</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        <ClipPlayer uri={clipUri} autoPlay={visible} />
        <Text style={styles.question}>{context.studyQuestion || context.sourceSentence}</Text>
        {context.studyHint ? <View style={styles.hint}><Text style={styles.hintLabel}>MEANING HINT · ENGLISH</Text><Text style={styles.hintText}>{context.studyHint}</Text></View> : null}
        {!revealed ? <Pressable style={styles.primary} onPress={() => setRevealed(true)}><Text style={styles.primaryText}>Show answer</Text></Pressable> : <Answer item={item} context={context} />}
      </ScrollView>
    </View>
  </Modal>;
}

function Answer({ item, context }: { item: LibraryItem; context: LibraryContext }) {
  return <View style={styles.answer}>
    <Text style={styles.term}>{context.studyAnswer || item.term}</Text>
    <Text style={styles.source}>{context.sourceSentence}</Text>
    {context.translatedSentence ? <Text style={styles.translation}>{context.translatedSentence}</Text> : null}
    <View style={styles.facts}>
      <Fact label="Lemma" value={String(context.dictionaryLemma || item.lemma || '')} />
      <Fact label="Part of speech" value={String(context.partOfSpeech || item.unitType || '')} />
      <Fact label="Word form" value={String(context.wordForm || '')} />
      <Fact label="CEFR" value={context.cefrLevel} />
    </View>
    {context.dictionaryDefinitions.length ? <View style={styles.definitions}><Text style={styles.sectionTitle}>Dictionary definitions</Text>{context.dictionaryDefinitions.map((definition, index) => <Text key={`${definition}-${index}`} style={styles.definition}>{index + 1}. {definition}</Text>)}</View> : null}
  </View>;
}
function Fact({ label, value }: { label: string; value: string }) { if (!value) return null; return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.background},header:{paddingTop:18,paddingHorizontal:20,paddingBottom:14,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderColor:colors.border},title:{fontSize:22,fontWeight:'800',color:colors.text},close:{fontSize:16,fontWeight:'700',color:colors.accent},content:{padding:20,gap:18,paddingBottom:50},question:{fontSize:25,lineHeight:35,fontWeight:'700',color:colors.text,textAlign:'center',paddingVertical:8},hint:{padding:16,borderRadius:14,backgroundColor:'#2b2517',borderWidth:1,borderColor:'#5a4921'},hintLabel:{fontSize:11,fontWeight:'800',letterSpacing:1,color:colors.hint,marginBottom:7},hintText:{fontSize:17,lineHeight:25,color:colors.text},primary:{padding:16,borderRadius:14,backgroundColor:colors.accent,alignItems:'center'},primaryText:{fontSize:17,fontWeight:'800',color:'#06120f'},answer:{gap:14,padding:18,borderRadius:18,backgroundColor:colors.panel},term:{fontSize:32,fontWeight:'900',color:colors.accent},source:{fontSize:19,lineHeight:28,color:colors.text},translation:{fontSize:17,lineHeight:25,color:colors.muted},facts:{gap:8},fact:{flexDirection:'row',justifyContent:'space-between',gap:16,paddingVertical:8,borderBottomWidth:1,borderColor:colors.border},factLabel:{color:colors.muted},factValue:{color:colors.text,fontWeight:'700',flexShrink:1,textAlign:'right'},definitions:{gap:8},sectionTitle:{fontSize:15,fontWeight:'800',color:colors.text},definition:{fontSize:16,lineHeight:24,color:colors.text}
});
