import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Fraunces_500Medium, Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth";
import { Loading } from "@/components/ui";
import { colors, fonts } from "@/lib/theme";

export default function RootLayout() {
  const [loaded, error] = useFonts({ Fraunces_500Medium, Fraunces_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  // If fonts fail to load (e.g. offline), carry on with system fonts.
  if (!loaded && !error) return <Loading />;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.deep },
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: fonts.display },
            contentStyle: { backgroundColor: colors.night },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="invite/[token]" options={{ title: "Join your family" }} />
          <Stack.Screen name="tree" options={{ title: "One Family" }} />
          <Stack.Screen name="person/[id]" options={{ title: "Person" }} />
          <Stack.Screen name="inbox" options={{ title: "Requests and votes" }} />
          <Stack.Screen name="join" options={{ title: "Join the tree" }} />
          <Stack.Screen name="find" options={{ title: "Find your family", headerBackVisible: false }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
