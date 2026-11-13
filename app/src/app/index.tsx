import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/components/ui";

export default function Index() {
  const { ready, token } = useAuth();
  if (!ready) return <Loading />;
  return <Redirect href={token ? "/tree" : "/welcome"} />;
}
