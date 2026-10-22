#import <AppKit/AppKit.h>
#include <node_api.h>
#include <objc/message.h>
#include <string.h>

static NSWindow* WindowFromHandle(napi_env env, napi_value handle) {
  bool isBuffer = false;
  if (napi_is_buffer(env, handle, &isBuffer) != napi_ok || !isBuffer) return nil;
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, handle, &data, &length) != napi_ok) return nil;
  if (data == nullptr || length != sizeof(void*)) return nil;
  void* raw = nullptr;
  memcpy(&raw, data, sizeof(void*));
  if (raw == nullptr) return nil;
  for (NSWindow* window in [NSApp windows]) {
    if ((__bridge void*)window.contentView == raw) return window;
  }
  return nil;
}

static napi_value Result(napi_env env, const char* text) {
  napi_value result;
  napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result);
  return result;
}

static napi_value PreventActivation(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count < 1)
    return Result(env, "no-window");
  NSWindow* window = WindowFromHandle(env, args[0]);
  if (window == nil) return Result(env, "no-window");
  SEL selector = NSSelectorFromString(@"_setPreventsActivation:");
  if (![window respondsToSelector:selector]) return Result(env, "unsupported");
  reinterpret_cast<void (*)(id, SEL, BOOL)>(objc_msgSend)(window, selector, YES);
  return Result(env, "applied");
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "preventActivation", NAPI_AUTO_LENGTH, PreventActivation, nullptr,
                       &fn);
  napi_set_named_property(env, exports, "preventActivation", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
