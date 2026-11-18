#import <AppKit/AppKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
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

static napi_value OwnerAuthAvailable(napi_env env, napi_callback_info info) {
  LAContext* context = [[LAContext alloc] init];
  bool available = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil];
  napi_value result;
  napi_get_boolean(env, available, &result);
  return result;
}

static const char* OutcomeOf(BOOL success, NSError* error) {
  if (success) return "ok";
  if (![error.domain isEqualToString:LAErrorDomain]) return "failed";
  switch (error.code) {
    case LAErrorUserCancel:
    case LAErrorAppCancel:
    case LAErrorSystemCancel:
      return "cancelled";
    case LAErrorPasscodeNotSet:
      return "unavailable";
    default:
      return "failed";
  }
}

static void DeliverOutcome(napi_env env, napi_value callback, void* context, void* data) {
  if (env == nullptr || callback == nullptr) return;
  napi_value receiver;
  napi_get_undefined(env, &receiver);
  napi_value outcome = Result(env, static_cast<const char*>(data));
  napi_call_function(env, receiver, callback, 1, &outcome, nullptr);
}

static napi_value AuthenticateOwner(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count < 2)
    return Result(env, "failed");
  char reason[512];
  size_t length = 0;
  if (napi_get_value_string_utf8(env, args[0], reason, sizeof(reason), &length) != napi_ok ||
      length == 0)
    return Result(env, "failed");
  napi_threadsafe_function deliver;
  if (napi_create_threadsafe_function(env, args[1], nullptr, Result(env, "ownerAuthentication"),
                                      0, 1, nullptr, nullptr, nullptr, DeliverOutcome,
                                      &deliver) != napi_ok)
    return Result(env, "failed");
  LAContext* context = [[LAContext alloc] init];
  auto finish = ^(const char* outcome) {
    napi_call_threadsafe_function(deliver, const_cast<char*>(outcome), napi_tsfn_blocking);
    napi_release_threadsafe_function(deliver, napi_tsfn_release);
  };
  if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil]) {
    finish("unavailable");
    return Result(env, "started");
  }
  [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
          localizedReason:[NSString stringWithUTF8String:reason]
                    reply:^(BOOL success, NSError* error) {
                      finish(OutcomeOf(success, error));
                    }];
  return Result(env, "started");
}

static void Export(napi_env env, napi_value exports, const char* name, napi_callback callback) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &fn);
  napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
  Export(env, exports, "preventActivation", PreventActivation);
  Export(env, exports, "ownerAuthAvailable", OwnerAuthAvailable);
  Export(env, exports, "authenticateOwner", AuthenticateOwner);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
