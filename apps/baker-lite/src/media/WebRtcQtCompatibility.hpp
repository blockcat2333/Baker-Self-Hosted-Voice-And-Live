#pragma once

// Qt's signal keyword macro collides with sigslot::emit() in libwebrtc.
// Q_EMIT remains available to Baker Lite after the keyword is undefined.
#ifdef emit
#undef emit
#endif
