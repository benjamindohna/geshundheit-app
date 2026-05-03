import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const auth = request.cookies.get('auth')
  const { pathname } = request.nextUrl

  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth')

  if (!auth?.value && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (auth?.value && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)'],
}
