import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, type Tree } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { generationName, placeTree } from "@/lib/family";
import { colors, fonts } from "@/lib/theme";
import { PersonCard } from "@/components/PersonCard";
import { Rise } from "@/components/animations";
import { Body, Button, ErrorText, Loading } from "@/components/ui";

export default function TreeScreen() {
  const { root } = useLocalSearchParams<{ root?: string }>();
  const { token, signOut, ready } = useAuth();
  const [tree, setTree] = useState<Tree | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const client = api(token);
      const [t, me] = await Promise.all([client.tree(root, 3), client.me()]);
      setTree(t);
      setWaiting(me.pending.length + me.votes.length);
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
      <ScrollView
        style={{ backgroundColor: colors.night }}
        contentContainerStyle={styles.content}
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
        <Text style={styles.tagline}>Every name is a light. Every line is a bond.</Text>
        <ErrorText>{error}</ErrorText>
        {rows.map((row, i) => (
          <Rise key={row.generation} index={i}>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{generationName(row.generation)}</Text>
              <View style={styles.cards}>
                {row.people.map((p) => (
                  <PersonCard
                    key={p.person.id}
                    person={p.person}
                    label={p.label}
                    isMe={p.person.id === tree.me}
                    pending={p.pending}
                    onPress={() => router.push({ pathname: "/person/[id]", params: { id: p.person.id } })}
                  />
                ))}
              </View>
            </View>
          </Rise>
        ))}
        {rows.length === 1 && rows[0].people.length === 1 && (
          <Body muted>Your tree starts with you. Tap your card to add your parents, children, brothers and sisters.</Body>
        )}
        {root && root !== tree.me && <Button kind="secondary" title="Back to my tree" onPress={() => router.replace("/tree")} />}
      </ScrollView>
    </>
  );
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
});
