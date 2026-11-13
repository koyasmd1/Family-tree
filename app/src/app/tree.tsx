import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, type Tree } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { generationName, placeTree } from "@/lib/family";
import { colors, fonts } from "@/lib/theme";
import { PersonCard } from "@/components/PersonCard";
import { Rise } from "@/components/animations";
import { Celebration, type Moment } from "@/components/Celebration";
import { Constellation, EarthEmbrace, Heartline } from "@/components/moments";
import { TreeLines, type Box } from "@/components/TreeLines";
import { Body, Button, ErrorText, Loading } from "@/components/ui";

export default function TreeScreen() {
  const { root } = useLocalSearchParams<{ root?: string }>();
  const { token, signOut, ready } = useAuth();
  const [tree, setTree] = useState<Tree | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [moment, setMoment] = useState<Moment | null>(null);
  const closeMoment = useCallback(() => setMoment(null), []);
  const lines = useCardBoxes(tree);

  const journeyShown = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const client = api(token);
      const [t, me] = await Promise.all([client.tree(root, 3), client.me()]);
      setTree(t);
      setWaiting(me.pending.length + me.votes.length);
      // 24 "Journey Back in Time": opening the tree of an older relative.
      if (t.root !== t.me && journeyShown.current !== t.root) {
        journeyShown.current = t.root;
        const placed = placeTree(t).rows.flatMap((r) => r.people);
        const mine = placed.find((p) => p.person.id === t.me);
        const rootName = t.people.find((p) => p.id === t.root)?.full_name;
        if (mine && mine.generation > 0 && rootName) {
          setMoment({ kind: "journey", title: `Back to ${rootName}`, body: `Travelling up ${mine.generation === 1 ? "one generation" : `${mine.generation} generations`}.`, duration: 2200 });
        }
      }
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 401) {
        await signOut();
        router.replace("/welcome");
        return;
      }
      setError(err.message);
    }
  }, [token, root, signOut]);

  useFocusEffect(
    useCallback(() => {
      if (ready && !token) router.replace("/welcome");
      else load();
    }, [ready, token, load]),
  );

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Requests and votes, ${waiting} waiting`} onPress={() => router.push("/inbox")} style={styles.headerBtn}>
              <Text style={styles.headerText}>Requests</Text>
              {waiting > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{waiting}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                await signOut();
                router.replace("/welcome");
              }}
              style={styles.headerBtn}
            >
              <Text style={styles.headerText}>Sign out</Text>
            </Pressable>
          </View>
        ),
      }}
    />
  );

  if (!tree) {
    return (
      <>
        {header}
        {error ? (
          <View style={{ flex: 1, padding: 20, gap: 12, backgroundColor: colors.night }}>
            <ErrorText>{error}</ErrorText>
            <Button title="Try again" onPress={load} />
          </View>
        ) : (
          <Loading />
        )}
      </>
    );
  }

  const { rows } = placeTree(tree);
  return (
    <>
      {header}
      <View style={{ flex: 1, backgroundColor: colors.night }}>
        <Constellation />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          onContentSizeChange={lines.onContentSize}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.gold}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          <TreeLines relations={tree.relations} boxes={lines.boxes} width={lines.size.w} height={lines.size.h} />
          <Text style={styles.tagline}>Every name is a light. Every line is a bond.</Text>
          <ErrorText>{error}</ErrorText>
          {rows.map((row, i) => (
            <Rise key={row.generation} index={i} onLayout={lines.onRow(row.generation)}>
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{generationName(row.generation)}</Text>
                <View style={styles.cards} onLayout={lines.onCards(row.generation)}>
                  {row.people.map((p) => (
                    <PersonCard
                      key={p.person.id}
                      person={p.person}
                      label={p.label}
                      isMe={p.person.id === tree.me}
                      pending={p.pending}
                      onLayout={lines.onCard(p.person.id, row.generation)}
                      onPress={() => router.push({ pathname: "/person/[id]", params: { id: p.person.id } })}
                    />
                  ))}
                </View>
              </View>
            </Rise>
          ))}
          {rows.length === 1 && rows[0].people.length === 1 && (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Heartline size={200} />
              <Body muted>Your tree starts with you. Tap your card to add your parents, children, brothers and sisters.</Body>
            </View>
          )}
          {root && root !== tree.me && <Button kind="secondary" title="Back to my tree" onPress={() => router.replace("/tree")} />}
          <View style={styles.footer}>
            <EarthEmbrace size={180} />
          </View>
        </ScrollView>
      </View>
      <Celebration moment={moment} onDone={closeMoment} />
    </>
  );
}

/**
 * Remembers where every card sits inside the scrolling area, so the lines
 * between relatives can be drawn behind the cards.
 */
function useCardBoxes(tree: Tree | null) {
  const rows = useRef(new Map<number, { x: number; y: number }>());
  const cards = useRef(new Map<number, { x: number; y: number }>());
  const people = useRef(new Map<string, { gen: number; x: number; y: number; w: number; h: number }>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = useRef<Set<string>>(new Set());
  ids.current = new Set(tree?.people.map((p) => p.id) ?? []);

  const recompute = useCallback(() => {
    if (frame.current) return;
    frame.current = setTimeout(() => {
      frame.current = null;
      const next = new Map<string, Box>();
      for (const [id, c] of people.current) {
        const row = rows.current.get(c.gen);
        const box = cards.current.get(c.gen);
        if (!row || !box || !ids.current.has(id)) continue;
        next.set(id, { x: row.x + box.x + c.x, y: row.y + box.y + c.y, w: c.w, h: c.h });
      }
      setBoxes(next);
    }, 16);
  }, []);

  useEffect(() => () => {
    if (frame.current) clearTimeout(frame.current);
  }, []);
  useEffect(recompute, [tree, recompute]);

  return {
    boxes,
    size,
    onContentSize: (w: number, h: number) => setSize((s) => (s.w === w && s.h === h ? s : { w, h })),
    onRow: (gen: number) => (e: LayoutChangeEvent) => {
      const { x, y } = e.nativeEvent.layout;
      rows.current.set(gen, { x, y });
      recompute();
    },
    onCards: (gen: number) => (e: LayoutChangeEvent) => {
      const { x, y } = e.nativeEvent.layout;
      cards.current.set(gen, { x, y });
      recompute();
    },
    onCard: (id: string, gen: number) => (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      people.current.set(id, { gen, x, y, w: width, h: height });
      recompute();
    },
  };
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 18, paddingBottom: 48, width: "100%", maxWidth: 1100, alignSelf: "center" },
  tagline: { fontFamily: fonts.display, fontSize: 16, color: colors.muted, textAlign: "center" },
  row: { gap: 6, borderTopWidth: 1, borderTopColor: colors.lanternBorder, paddingTop: 10 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.5, color: colors.gold, textTransform: "uppercase" },
  cards: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  headerActions: { flexDirection: "row", gap: 4, marginRight: 8 },
  headerBtn: { minHeight: 44, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  headerText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.text },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.night },
  footer: { alignItems: "center", marginTop: 24 },
});
