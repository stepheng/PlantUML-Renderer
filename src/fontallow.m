// Injected into plantuml-native via DYLD_INSERT_LIBRARIES. The JDK's macOS font manager
// (AWTFont.m GetFilteredFonts) walks -[NSFontManager availableFontFamilies] and asks CoreText
// for every member's traits; on a machine with hundreds of fonts that dominates cold start.
// PLANTUML_FONT_FAMILIES="Lucida Grande,Helvetica,..." is returned as the family list as-is:
// even the original call alone enumerates every installed font, so it is never made.
// A listed family that isn't installed has no members, so Java skips it. Names match
// case-insensitively. Built by `npm run build:fontallow`.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static NSArray *families;

static NSArray *allowedFamilies(id self, SEL cmd) {
    return families;
}

__attribute__((constructor)) static void install(void) {
    const char *env = getenv("PLANTUML_FONT_FAMILIES");
    if (!env || !*env) return;
    NSMutableArray *names = [NSMutableArray array];
    for (NSString *name in [[NSString stringWithUTF8String:env] componentsSeparatedByString:@","])
        [names addObject:[name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]];
    families = names;
    Method m = class_getInstanceMethod(NSFontManager.class, @selector(availableFontFamilies));
    method_setImplementation(m, (IMP)allowedFamilies);
}
