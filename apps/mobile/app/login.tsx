import { Button } from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { rawTheme, ThemeName } from "@/lib/colors";
import useAuthStore from "@/store/auth";
import {
  isAtLeastInstanceVersion,
  type Config,
} from "@linkwarden/router/config";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { Redirect, router } from "expo-router";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import {
  Dimensions,
  Image,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import {
  KeyboardStickyView,
  KeyboardToolbar,
} from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

const cloudInstance = "https://cloud.linkwarden.app";

export default function HomeScreen() {
  const { auth, signIn, signInWithApple, signInWithGoogle } = useAuthStore();
  const { colorScheme } = useColorScheme();
  const [method, setMethod] = useState<"password" | "token">("password");
  const [isLoading, setIsLoading] = useState(false);
  const [appleEnabled, setAppleEnabled] = useState(
    Platform.OS === "ios" && (auth.instance || cloudInstance) === cloudInstance
  );
  const [googleEnabled, setGoogleEnabled] = useState(
    (auth.instance || cloudInstance) === cloudInstance
  );
  const [isCheckingOAuth, setIsCheckingOAuth] = useState(false);

  const [form, setForm] = useState({
    user: "",
    password: "",
    token: "",
    instance: auth.instance || cloudInstance,
  });

  const [showInstanceField, setShowInstanceField] = useState(
    form.instance !== cloudInstance
  );

  const instance = form.instance.trim().replace(/\/+$/, "");

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      instance: auth.instance || cloudInstance,
    }));
  }, [auth.instance]);

  useEffect(() => {
    setShowInstanceField(form.instance !== cloudInstance);
  }, [form.instance]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      token: "",
      user: "",
      password: "",
    }));
  }, [method]);

  useEffect(() => {
    if (!instance) {
      setAppleEnabled(false);
      setGoogleEnabled(false);
      return;
    }

    setAppleEnabled(Platform.OS === "ios" && instance === cloudInstance);
    setGoogleEnabled(instance === cloudInstance);
    setIsCheckingOAuth(true);
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const [configRes, loginsRes] = await Promise.all([
          fetch(`${instance}/api/v1/config`),
          fetch(`${instance}/api/v1/logins`),
        ]);

        if (!active || !configRes.ok || !loginsRes.ok) return;

        const config = ((await configRes.json())?.response ??
          null) as Config | null;
        const logins = await loginsRes.json().catch(() => null);
        const versionOk = isAtLeastInstanceVersion(
          config?.INSTANCE_VERSION,
          "v2.15.0"
        );
        const hasApple =
          logins?.buttonAuths?.some(
            (b: { method?: string }) => b.method === "apple"
          ) === true;
        const hasGoogle =
          logins?.buttonAuths?.some(
            (b: { method?: string }) => b.method === "google"
          ) === true;

        if (active) {
          setAppleEnabled(Platform.OS === "ios" && hasApple && versionOk);
          setGoogleEnabled(hasGoogle && versionOk);
        }
      } catch {
      } finally {
        if (active) setIsCheckingOAuth(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [instance]);

  if (auth.status === "authenticated") {
    return <Redirect href="/dashboard" />;
  }

  return (
    <>
      <KeyboardStickyView className="flex-col justify-end h-full bg-base-100 relative">
        <View className="flex-col justify-end h-full bg-primary relative">
          <View className="my-auto">
            <Image
              source={require("@/assets/images/linkwarden.png")}
              className="w-[120px] h-[120px] mx-auto"
            />
          </View>
          <Text className="text-base-100 text-5xl font-bold ml-8">Login</Text>
          <View>
            <Text
              className="text-base-100 text-2xl mx-8 mt-3"
              numberOfLines={1}
            >
              Login to{" "}
              {form.instance === "https://cloud.linkwarden.app"
                ? "cloud.linkwarden.app"
                : form.instance}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (showInstanceField) {
                  setForm({
                    ...form,
                    instance: "https://cloud.linkwarden.app",
                  });
                }
                setShowInstanceField(!showInstanceField);
              }}
              className="mx-8 mt-1 self-start"
            >
              <Text className="text-neutral-content text-sm">
                {!showInstanceField ? "Change server" : "Use official server"}
              </Text>
            </TouchableOpacity>
          </View>
          <Svg
            viewBox="0 0 1440 320"
            width={Dimensions.get("screen").width}
            height={Dimensions.get("screen").width * (320 / 1440) + 2}
          >
            <Path
              fill={rawTheme[colorScheme as ThemeName]["base-100"]}
              fill-opacity="1"
              d="M0,256L48,234.7C96,213,192,171,288,176C384,181,480,235,576,266.7C672,299,768,309,864,277.3C960,245,1056,171,1152,122.7C1248,75,1344,53,1392,42.7L1440,32L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </Svg>
          <SafeAreaView
            edges={["bottom"]}
            className="flex-col justify-end h-auto duration-100 pt-10 bg-base-100 -mt-2 pb-10 gap-4 w-full px-4"
          >
            {showInstanceField && (
              <Input
                className="w-full text-xl p-3 leading-tight h-12"
                textAlignVertical="center"
                placeholder="Instance URL"
                selectTextOnFocus={false}
                value={form.instance}
                onChangeText={(text) => setForm({ ...form, instance: text })}
              />
            )}
            {method === "password" ? (
              <>
                <Input
                  className="w-full text-xl p-3 leading-tight h-12"
                  textAlignVertical="center"
                  placeholder="Email or Username"
                  value={form.user}
                  onChangeText={(text) => setForm({ ...form, user: text })}
                />
                <Input
                  className="w-full text-xl p-3 leading-tight h-12"
                  textAlignVertical="center"
                  placeholder="Password"
                  secureTextEntry
                  value={form.password}
                  onChangeText={(text) => setForm({ ...form, password: text })}
                />
              </>
            ) : (
              <Input
                className="w-full text-xl p-3 leading-tight h-12"
                textAlignVertical="center"
                placeholder="Access Token"
                secureTextEntry
                value={form.token}
                onChangeText={(text) => setForm({ ...form, token: text })}
              />
            )}

            <TouchableOpacity
              onPress={() =>
                setMethod(method === "password" ? "token" : "password")
              }
              className="w-fit mx-auto"
            >
              <Text className="text-primary w-fit text-center">
                {method === "password"
                  ? "Login with Access Token"
                  : "Login with Username/Password"}
              </Text>
            </TouchableOpacity>

            <Button
              variant="accent"
              size="lg"
              isLoading={isLoading}
              onPress={async () => {
                if (
                  ((form.user && form.password) || form.token) &&
                  form.instance
                ) {
                  setIsLoading(true);
                  await signIn(
                    form.user,
                    form.password,
                    form.instance,
                    form.token
                  );
                  setIsLoading(false);
                }
              }}
            >
              <Text className="text-white text-xl">Login</Text>
            </Button>
            {appleEnabled && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                }
                buttonStyle={
                  colorScheme === "dark"
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={8}
                style={{ width: "100%", height: 48 }}
                onPress={() => {
                  if (isCheckingOAuth) return;
                  signInWithApple(instance);
                }}
              />
            )}
            {googleEnabled && (
              <GoogleSigninButton
                size={GoogleSigninButton.Size.Wide}
                color={
                  colorScheme === "dark"
                    ? GoogleSigninButton.Color.Light
                    : GoogleSigninButton.Color.Dark
                }
                style={{ width: "100%", height: 48 }}
                onPress={() => {
                  if (isCheckingOAuth) return;
                  signInWithGoogle(instance);
                }}
              />
            )}
            <TouchableOpacity
              className="w-fit mx-auto"
              onPress={() => router.replace("/register")}
            >
              <Text className="text-neutral text-center w-fit">
                Don't have an account? Sign up
              </Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </KeyboardStickyView>
      <KeyboardToolbar />
    </>
  );
}
