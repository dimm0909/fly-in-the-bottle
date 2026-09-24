CXX ?= g++
CXXFLAGS ?= -O3 -march=native -ffast-math -std=c++17 -Wall -Wextra
OUT = ../data/brain/brain

all: $(OUT)
$(OUT): main.cpp cpu.cpp brain.h
	$(CXX) $(CXXFLAGS) main.cpp cpu.cpp -o $(OUT)
clean:
	rm -f $(OUT)
