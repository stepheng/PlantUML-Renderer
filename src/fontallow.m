// Injected into plantuml-native via DYLD_INSERT_LIBRARIES. The JDK's macOS font manager
// (AWTFont.m GetFilteredFonts) walks -[NSFontManager availableFontFamilies] and asks CoreText
// for every member's traits; on a machine with hundreds of fonts that dominates cold start.
// PLANTUML_FONT_FAMILIES="lucida grande,helvetica,..." limits the walk to those families
// (matched case-insensitively). Glyph fallback (CJK, emoji) still works without them.
// Built by `npm run build:fontallow`.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static IMP original;
static NSSet *allowed;

static NSArray *allowedFamilies(id self, SEL cmd) {
    NSArray *all = ((NSArray *(*)(id, SEL))original)(self, cmd);
    NSMutableArray *kept = [NSMutableArray array];
    for (NSString *family in all) if ([allowed containsObject:family.lowercaseString]) [kept addObject:family];
    return kept;
}

__attribute__((constructor)) static void install(void) {
    const char *env = getenv("PLANTUML_FONT_FAMILIES");
    if (!env || !*env) return;
    NSMutableSet *names = [NSMutableSet set];
    for (NSString *name in [[NSString stringWithUTF8String:env] componentsSeparatedByString:@","])
        [names addObject:[name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet].lowercaseString];
    allowed = names;
    Method m = class_getInstanceMethod(NSFontManager.class, @selector(availableFontFamilies));
    original = method_setImplementation(m, (IMP)allowedFamilies);
}
