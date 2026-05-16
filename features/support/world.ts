import { After, setWorldConstructor } from '@cucumber/cucumber';
import { cleanup, RenderAPI } from '@testing-library/react-native/pure';

export class AppWorld {
  screen?: RenderAPI;
  values: Record<string, unknown> = {};
}

setWorldConstructor(AppWorld);

After(function (this: AppWorld) {
  this.screen?.unmount();
  cleanup();
});
