// Animated versions of the SVG shapes. On the website, Animated passes a
// `collapsable` prop that only phones understand, so it is removed here.
import { forwardRef, type ComponentType } from "react";
import { Animated } from "react-native";
import { Circle, Ellipse, Path } from "react-native-svg";

function withoutCollapsable<P extends object>(Shape: ComponentType<P>) {
  const Clean = forwardRef<unknown, P & { collapsable?: boolean }>(({ collapsable: _ignored, ...rest }, ref) => {
    const Any = Shape as unknown as ComponentType<Record<string, unknown>>;
    return <Any ref={ref} {...rest} />;
  });
  Clean.displayName = `Animated${Shape.displayName ?? "Shape"}`;
  return Animated.createAnimatedComponent(Clean as unknown as ComponentType<P>);
}

export const APath = withoutCollapsable(Path);
export const ACircle = withoutCollapsable(Circle);
export const AEllipse = withoutCollapsable(Ellipse);
