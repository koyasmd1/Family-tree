import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, type PendingRelation, type Vote } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";
import { Body, Button, Card, ErrorText, Kicker, Loading, Screen, Title } from "@/components/ui";
import { Celebration, type Moment } from "@/components/Celebration";
import { VoteOfFour } from "@/components/moments";

const typeText = (t: string) => (t === "spouse" ? "husband or wife" : t === "sibling" ? "brother or sister" : "parent and child");

export default function Inbox() {
  const { token, ready } = useAuth();
  const { joined } = useLocalSearchParams<{ joined?: string }>();
  const [moment, setMoment] = useState<Moment | null>(
    joined
      ? { kind: "kinship", title: "Welcome to the family", body: "You've joined the tree. Your relatives are connected to you now. Check anything waiting for you below." }
      : null,
  );
  const [notice, setNotice] = useState("");
  const closeMoment = useCallback(() => setMoment(null), []);
  const [data, setData] = useState<{ me: string; pending: PendingRelation[]; votes: Vote[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    if (!token) return router.replace("/welcome");
    try {
      const me = await api(token).me();
      setData({ me: me.person.id, pending: me.pending, votes: me.votes });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token, ready]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function act(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      after?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return error ? <Screen><ErrorText>{error}</ErrorText></Screen> : <Loading />;

  const empty = data.pending.length === 0 && data.votes.length === 0;
  return (
    <Screen>
      <Kicker>WAITING FOR YOU</Kicker>
      <Title>Requests and votes</Title>
      <ErrorText>{error}</ErrorText>
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {empty && <Body muted>Nothing is waiting for you right now.</Body>}

      {data.pending.map((r) => {
        const otherName = r.a_id === data.me ? r.b_name : r.a_name;
        return (
          <Card key={r.id}>
            <Text style={styles.head}>Is {otherName} your {typeText(r.type)}?</Text>
            <Body muted>They were linked to you in the tree. It's only confirmed if you approve.</Body>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Yes, approve"
                  busy={busy === r.id + "y"}
                  onPress={() =>
                    act(
                      r.id + "y",
                      () => api(token).decide(r.id, true),
                      () => {
                        const text = `${otherName} is now confirmed as your ${typeText(r.type)}.`;
                        setNotice(text);
                        setMoment(
                          r.type === "spouse"
                            ? { kind: "woven", title: "Two families, woven together", body: text }
                            : { kind: "seal", title: "Approved", body: text },
                        );
                      },
                    )
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button kind="secondary" title="No" busy={busy === r.id + "n"} onPress={() => act(r.id + "n", () => api(token).decide(r.id, false))} />
              </View>
            </View>
          </Card>
        );
      })}

      {data.votes.map((v) => (
        <Card key={v.id}>
          <Text style={styles.head}>
            Should the link between {v.a_name} and {v.b_name} be removed?
          </Text>
          <Body muted>
            You were picked at random as one of 4 relatives. The link is removed only if 3 agree. So far: {v.agree} agree, {v.disagree} disagree.
          </Body>
          <VoteOfFour agree={v.agree} disagree={v.disagree} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button kind="danger" title="Yes, remove" busy={busy === v.id + "a"} onPress={() => act(v.id + "a", () => api(token).ballot(v.id, "agree"))} />
            </View>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" title="No, keep it" busy={busy === v.id + "d"} onPress={() => act(v.id + "d", () => api(token).ballot(v.id, "disagree"))} />
            </View>
          </View>
        </Card>
      ))}

      <Button kind="secondary" title="Go to my tree" onPress={() => router.replace("/tree")} />
      <Celebration moment={moment} onDone={closeMoment} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
  row: { flexDirection: "row", gap: 10 },
  notice: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.teal },
});
